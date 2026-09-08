// admin-users — administration des comptes : invitation, renvoi d'un lien de
// mot de passe, suppression.
//
// Habilitation, par action (JWT vérifié en code — verify_jwt=false pour les
// préflights OPTIONS) :
//   invite_user        · administrateur du tenant visé, ou admin plateforme
//                        (seul l'admin plateforme peut inviter sans tenant)
//   send_password_reset · autorité sur le compte cible (can_manage_account)
//   delete_user        · admin plateforme uniquement
// Les règles restent écrites en SQL (`is_org_admin_anywhere_for`,
// `can_manage_account`) : la fonction les consulte, elle ne les réinvente pas.
//
// Le serveur d'envoi utilisé ici n'est PAS réglé dans Iris : il vient du Socle
// (organisation principale du tenant), recopié par la synchronisation du
// référentiel dans `smtp_settings` — repli sur le relais de plateforme
// (`IRIS_SMTP_*`) si le Socle n'en déclare aucun. Voir docs/emails.md.
//
// AUCUN mot de passe n'est plus généré ni affiché : un compte s'ouvre par un
// lien d'activation, et se dépanne par un lien de réinitialisation — tous deux
// envoyés au titulaire, jamais à l'administrateur.
//
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";

import { resolveSmtp, type SmtpConfig, type SmtpRow } from "../_shared/email/config.ts";
import { authEmailContent, brandFor } from "../_shared/email/messages.ts";
import { sendBrandedEmail } from "../_shared/email/transport.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const APP_URL = (Deno.env.get("IRIS_APP_URL") ?? "http://localhost:5174").replace(/\/+$/, "");
const ALLOWED_ORIGINS = new Set(
  [Deno.env.get("IRIS_APP_URL"), "http://localhost:5174"].filter(Boolean) as string[],
);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) },
  });
}
function fail(req: Request, status: number, code: string, message: string): Response {
  return json(req, status, { error: { code, message } });
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Lien d'action pointant vers l'application, jeton en clair dans l'URL. */
function appLink(path: string, tokenHash: string, type: string): string {
  const url = new URL(`${APP_URL}${path}`);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  return url.toString();
}

/** Serveur d'envoi d'un tenant, relais de plateforme en repli. */
async function smtpForOrg(orgId: string | null): Promise<{ smtp: SmtpConfig | null; tenantName: string | null }> {
  let row: (SmtpRow & { organization_name?: string | null }) | null = null;
  if (orgId) {
    const { data, error } = await supabase.rpc("smtp_config_for_org", { p_org_id: orgId });
    if (error) console.error("admin-users: smtp_config_for_org en échec", error);
    row = (Array.isArray(data) ? data[0] : null) ?? null;
  }
  return { smtp: resolveSmtp(row, Deno.env.toObject()), tenantName: row?.organization_name ?? null };
}

/** Serveur d'envoi du tenant d'un destinataire (mêmes règles que le hook). */
async function smtpForUser(userId: string): Promise<{ smtp: SmtpConfig | null; tenantName: string | null }> {
  const { data, error } = await supabase.rpc("mail_context_for_user", { p_user_id: userId });
  if (error) console.error("admin-users: mail_context_for_user en échec", error);
  const row = ((Array.isArray(data) ? data[0] : null) ?? null) as
    | (SmtpRow & { organization_name?: string | null })
    | null;
  return { smtp: resolveSmtp(row, Deno.env.toObject()), tenantName: row?.organization_name ?? null };
}

/** Administration quelque part dans le tenant — suffit pour inviter un agent. */
async function isTenantAdmin(actorId: string, orgId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_org_admin_anywhere_for", {
    p_user_id: actorId,
    p_org_id: orgId,
  });
  if (error) {
    console.error("admin-users: is_org_admin_anywhere_for en échec", error);
    return false;
  }
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return fail(req, 405, "method_not_allowed", "POST attendu.");
  }

  // ---- Authentification de l'appelant --------------------------------------
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return fail(req, 401, "unauthorized", "Session invalide.");
  }
  const { data: caller } = await supabase
    .from("users")
    .select("id, email, first_name, last_name, is_platform_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!caller) {
    return fail(req, 403, "forbidden", "Profil introuvable.");
  }
  const isPlatformAdmin = caller.is_platform_admin === true;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;

  // ==========================================================================
  // invite_user — ouvre un compte et envoie le lien d'activation.
  // ==========================================================================
  if (action === "invite_user") {
    const email = str(body?.email).toLowerCase();
    const firstName = str(body?.first_name);
    const lastName = str(body?.last_name);
    // Coordonnées facultatives. Bornées ici comme en base
    // (`users_phones_length_check`) : ce qui dépasse est COUPÉ plutôt que
    // refusé — un numéro trop long ne vaut pas de perdre l'invitation.
    const landlinePhone = str(body?.landline_phone).slice(0, 40);
    const mobilePhone = str(body?.mobile_phone).slice(0, 40);
    const orgId = str(body?.organization_id) || null;

    if (!EMAIL_RE.test(email)) return fail(req, 400, "bad_request", "Email invalide.");

    if (orgId) {
      if (!(await isTenantAdmin(caller.id, orgId))) {
        return fail(req, 403, "forbidden", "Administration requise sur ce tenant.");
      }
    } else if (!isPlatformAdmin) {
      return fail(req, 400, "bad_request", "Tenant de rattachement requis.");
    }

    // Compte déjà connu ? `public.users` est tenu à jour par le trigger
    // handle_new_user — inutile de parcourir auth.users page par page.
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      if (!orgId) {
        return fail(req, 409, "conflict", "Un compte existe déjà avec cet email.");
      }
      const { data: member } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", orgId)
        .eq("user_id", existing.id)
        .maybeSingle();
      if (member) {
        return fail(req, 409, "conflict", "Ce compte est déjà membre de ce tenant.");
      }
      const { error: linkError } = await supabase
        .from("organization_members")
        .insert({ organization_id: orgId, user_id: existing.id, role: "agent" });
      if (linkError) {
        return fail(req, 500, "server_error", "Rattachement au tenant impossible.");
      }
      // Le compte a déjà un mot de passe : aucun lien d'activation à envoyer.
      return json(req, 200, {
        user_id: existing.id,
        email,
        invited: false,
        email_sent: false,
        message: "Compte existant rattaché au tenant.",
      });
    }

    // Création SANS mot de passe : le compte n'est utilisable qu'après
    // activation par son titulaire. `email_confirm: false` est indispensable —
    // un compte confirmé ne peut plus recevoir de lien d'invitation.
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { first_name: firstName || null, last_name: lastName || null },
    });
    if (createError || !created.user) {
      console.error("admin-users: createUser en échec", createError);
      return fail(req, 409, "conflict", "Création du compte impossible.");
    }
    const newUserId = created.user.id;

    // Le trigger handle_new_user a créé le profil depuis `user_metadata` ; on
    // fiabilise les noms et on pose les coordonnées, que le trigger ne lit pas.
    await supabase
      .from("users")
      .update({
        first_name: firstName || null,
        last_name: lastName || null,
        landline_phone: landlinePhone || null,
        mobile_phone: mobilePhone || null,
      })
      .eq("id", newUserId);

    if (orgId) {
      // RM-43/RM-44 : simple accès au tenant, sans rôle — l'attribution d'un
      // profil de droits reste un geste du tenant (Paramètres › Droits).
      const { error: linkError } = await supabase
        .from("organization_members")
        .insert({ organization_id: orgId, user_id: newUserId, role: "agent" });
      if (linkError) {
        console.error("admin-users: rattachement en échec", linkError);
        return fail(req, 500, "server_error", "Compte créé, mais rattachement au tenant en échec.");
      }
    }

    const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: `${APP_URL}/activer-compte` },
    });
    if (linkError || !link?.properties?.hashed_token) {
      console.error("admin-users: generateLink invite en échec", linkError);
      return json(req, 201, {
        user_id: newUserId,
        email,
        invited: true,
        email_sent: false,
        email_error: "Lien d'activation impossible à produire.",
      });
    }

    const { smtp, tenantName } = await smtpForOrg(orgId);
    if (!smtp) {
      return json(req, 201, {
        user_id: newUserId,
        email,
        invited: true,
        email_sent: false,
        email_error:
          "Compte créé, mais aucun serveur d'envoi n'est configuré : renseignez-le dans le Socle "
          + "(organisation principale, onglet « Emails (SMTP) ») puis synchronisez le référentiel.",
      });
    }

    const content = authEmailContent("invite", {
      tenantName,
      recipientName: [firstName, lastName].filter(Boolean).join(" ") || null,
      actionUrl: appLink("/activer-compte", link.properties.hashed_token, "invite"),
    });

    try {
      await sendBrandedEmail(smtp, email, content, brandFor(tenantName));
    } catch (err) {
      console.error("admin-users: envoi de l'invitation en échec", err);
      return json(req, 201, {
        user_id: newUserId,
        email,
        invited: true,
        email_sent: false,
        email_error: err instanceof Error ? err.message : "Envoi impossible.",
      });
    }

    console.log(`admin-users: invitation envoyée à ${email} (tenant=${orgId ?? "—"}, relais=${smtp.source})`);
    return json(req, 201, { user_id: newUserId, email, invited: true, email_sent: true });
  }

  // ==========================================================================
  // send_password_reset — renvoie au titulaire un lien de réinitialisation.
  // ==========================================================================
  if (action === "send_password_reset") {
    const userId = str(body?.user_id);
    if (!userId) return fail(req, 400, "bad_request", "user_id requis.");

    const { data: allowed, error: allowedError } = await supabase.rpc("can_manage_account", {
      p_actor_id: caller.id,
      p_target_id: userId,
    });
    if (allowedError) {
      console.error("admin-users: can_manage_account en échec", allowedError);
      return fail(req, 500, "server_error", "Vérification des droits impossible.");
    }
    if (allowed !== true) {
      return fail(req, 403, "forbidden", "Vous n'avez pas autorité sur ce compte.");
    }

    const { data: target } = await supabase
      .from("users")
      .select("id, email, first_name, last_name")
      .eq("id", userId)
      .maybeSingle();
    if (!target?.email) return fail(req, 404, "not_found", "Compte introuvable.");

    const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: target.email,
      options: { redirectTo: `${APP_URL}/nouveau-mot-de-passe` },
    });
    if (linkError || !link?.properties?.hashed_token) {
      console.error("admin-users: generateLink recovery en échec", linkError);
      return fail(req, 500, "server_error", "Lien de réinitialisation impossible à produire.");
    }

    const { smtp, tenantName } = await smtpForUser(userId);
    if (!smtp) {
      return fail(
        req,
        400,
        "smtp_missing",
        "Aucun serveur d'envoi configuré : renseignez-le dans le Socle (organisation "
          + "principale, onglet « Emails (SMTP) ») puis synchronisez le référentiel.",
      );
    }

    const content = authEmailContent("recovery", {
      tenantName,
      recipientName: [target.first_name, target.last_name].filter(Boolean).join(" ") || null,
      actionUrl: appLink("/nouveau-mot-de-passe", link.properties.hashed_token, "recovery"),
    });

    try {
      await sendBrandedEmail(smtp, target.email, content, brandFor(tenantName));
    } catch (err) {
      console.error("admin-users: envoi de la réinitialisation en échec", err);
      return fail(req, 502, "send_failed", err instanceof Error ? err.message : "Envoi impossible.");
    }

    console.log(`admin-users: lien de réinitialisation envoyé à ${target.email} (relais=${smtp.source})`);
    return json(req, 200, { user_id: userId, email: target.email, email_sent: true });
  }

  // ==========================================================================
  // delete_user — plateforme uniquement.
  // ==========================================================================
  if (action === "delete_user") {
    if (!isPlatformAdmin) {
      return fail(req, 403, "forbidden", "Réservé aux administrateurs plateforme.");
    }
    const userId = str(body?.user_id);
    if (!userId) return fail(req, 400, "bad_request", "user_id requis.");
    if (userId === caller.id) {
      return fail(req, 400, "bad_request", "Impossible de supprimer son propre compte.");
    }
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) return fail(req, 404, "not_found", "Compte introuvable.");
    return json(req, 200, { deleted: userId });
  }

  return fail(
    req,
    400,
    "bad_request",
    "action inconnue (invite_user, send_password_reset, delete_user).",
  );
});
