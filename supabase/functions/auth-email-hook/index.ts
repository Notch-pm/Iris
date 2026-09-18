// auth-email-hook — gabarit Iris pour TOUS les mails émis par GoTrue
// (mot de passe oublié, invitation, lien de connexion, changement d'adresse,
// code de réauthentification). Motif du hook Clara.
//
// Branchement : Dashboard Supabase › Authentication › Hooks › « Send Email »
// → cette fonction + le secret généré (`AUTH_HOOK_SECRET`). Tant que le hook
// n'est pas activé, GoTrue envoie ses propres mails anglais par son relais
// bridé — voir docs/emails.md.
//
// Authentification : signature Standard Webhooks (verify_jwt = false, GoTrue
// n'envoie pas de JWT). Aucune autre porte d'entrée.
//
// Serveur d'envoi : celui du tenant du destinataire (smtp_settings, mot de
// passe déchiffré côté base par `mail_context_for_user`, SERVICE only), à
// défaut le relais de plateforme (secrets IRIS_SMTP_*).

import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "npm:standardwebhooks@1.0.0";

import { resolveSmtp, type SmtpRow } from "../_shared/email/config.ts";
import { authEmailContent, authEmailKind, brandFor } from "../_shared/email/messages.ts";
import { sendBrandedEmail } from "../_shared/email/transport.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

interface HookPayload {
  user?: { id?: string; email?: string; user_metadata?: Record<string, unknown> | null };
  email_data?: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** GoTrue attend cette forme pour afficher une erreur de hook côté client. */
function hookError(status: number, message: string): Response {
  return json(status, { error: { http_code: status, message } });
}

/**
 * Lien d'action. `redirect_to` a DÉJÀ été validé par GoTrue contre la liste
 * d'URL autorisées du projet avant l'émission du hook : on peut y accrocher le
 * jeton, ce qui évite le double saut par /auth/v1/verify (et donc la perte du
 * fragment d'URL derrière certains proxys de messagerie). Sans `redirect_to`,
 * on retombe sur le lien de vérification GoTrue.
 */
function actionUrl(tokenHash: string, verifyType: string, redirectTo: string): string {
  if (redirectTo) {
    try {
      const url = new URL(redirectTo);
      url.searchParams.set("token_hash", tokenHash);
      url.searchParams.set("type", verifyType);
      return url.toString();
    } catch {
      console.error("auth-email-hook: redirect_to illisible, repli sur /auth/v1/verify");
    }
  }
  return `${SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(verifyType)}`;
}

function displayName(meta: Record<string, unknown> | null | undefined, row: {
  first_name: string | null;
  last_name: string | null;
} | null): string | null {
  const fromRow = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim();
  if (fromRow) return fromRow;
  const fromMeta = [meta?.first_name, meta?.last_name]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join(" ")
    .trim();
  return fromMeta || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return hookError(405, "POST attendu.");

  // ---- Signature Standard Webhooks -----------------------------------------
  // Le Dashboard fournit le secret sous la forme « v1,whsec_… » ; la
  // bibliothèque n'accepte que la partie base64.
  const rawSecret = Deno.env.get("AUTH_HOOK_SECRET");
  if (!rawSecret) {
    console.error("auth-email-hook: AUTH_HOOK_SECRET absent");
    return hookError(503, "Hook d'emails non configuré.");
  }

  const rawBody = await req.text();
  let payload: HookPayload;
  try {
    payload = new Webhook(rawSecret.replace(/^v1,whsec_/, "")).verify(rawBody, {
      "webhook-id": req.headers.get("webhook-id") ?? "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": req.headers.get("webhook-signature") ?? "",
    }) as HookPayload;
  } catch (err) {
    console.error("auth-email-hook: signature invalide", err);
    return hookError(403, "Signature invalide.");
  }

  const user = payload.user;
  const emailData = payload.email_data;
  if (!user?.id || !user.email || !emailData) {
    return hookError(400, "Charge utile invalide.");
  }

  // ---- Contexte : tenant, serveur d'envoi, identité du destinataire ---------
  const [{ data: mailRows, error: mailError }, { data: profile }] = await Promise.all([
    supabase.rpc("mail_context_for_user", { p_user_id: user.id }),
    supabase.from("users").select("first_name, last_name").eq("id", user.id).maybeSingle(),
  ]);

  if (mailError) {
    console.error("auth-email-hook: mail_context_for_user en échec", mailError);
  }

  const context = (Array.isArray(mailRows) ? mailRows[0] : null) as
    | (SmtpRow & { organization_name?: string | null })
    | null;

  const smtp = resolveSmtp(context, Deno.env.toObject());
  if (!smtp) {
    // Aucun relais : mieux vaut un échec franc (l'utilisateur voit que l'envoi
    // n'a pas eu lieu) qu'un mail perdu.
    console.error(`auth-email-hook: aucun serveur d'envoi pour ${user.id}`);
    return hookError(
      503,
      "Aucun serveur d'envoi configuré : définissez-le dans le Référentiel (organisation principale) puis synchronisez le référentiel.",
    );
  }

  // ---- Message --------------------------------------------------------------
  const kind = authEmailKind(emailData.email_action_type ?? "");
  const tenantName = context?.organization_name ?? null;
  const content = authEmailContent(kind, {
    tenantName,
    recipientName: displayName(user.user_metadata, profile ?? null),
    actionUrl:
      kind === "reauthentication"
        ? null
        : actionUrl(
            emailData.token_hash ?? "",
            kind === "email_change" ? "email_change" : kind,
            (emailData.redirect_to ?? "").trim(),
          ),
    code: emailData.token ?? null,
  });

  try {
    await sendBrandedEmail(smtp, user.email, content, brandFor(tenantName));
  } catch (err) {
    console.error("auth-email-hook: envoi en échec", err);
    return hookError(502, "L'envoi du message a échoué.");
  }

  console.log(
    `auth-email-hook: ${kind} → ${user.email} (tenant=${context?.organization_id ?? "—"}, relais=${smtp.source})`,
  );
  return json(200, {});
});
