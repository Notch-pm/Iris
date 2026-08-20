// admin-users — administration des comptes pour la zone superadmin.
// Réservée aux admins PLATEFORME (public.users.is_platform_admin), JWT vérifié
// en code (verify_jwt=false : préflights OPTIONS). Seules les opérations qui
// exigent la service role passent ici (création de compte, mot de passe,
// suppression) — lecture, profils et appartenances passent par le RLS.
// CORS : allowlist stricte (IRIS_APP_URL + localhost de dev).

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

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

function generatePassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return "Iris!" + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "x");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return fail(req, 405, "method_not_allowed", "POST attendu.");
  }

  // Authentification + habilitation plateforme.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return fail(req, 401, "unauthorized", "Session invalide.");
  }
  const { data: caller } = await supabase
    .from("users")
    .select("id, is_platform_admin")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!caller?.is_platform_admin) {
    return fail(req, 403, "forbidden", "Réservé aux administrateurs plateforme.");
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;

  if (action === "create_user") {
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const firstName = typeof body?.first_name === "string" ? body.first_name.trim() : "";
    const lastName = typeof body?.last_name === "string" ? body.last_name.trim() : "";
    if (!EMAIL_RE.test(email)) return fail(req, 400, "bad_request", "Email invalide.");

    const password = generatePassword();
    const { data: created, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName || null, last_name: lastName || null },
    });
    if (error || !created.user) {
      const message = error?.message?.includes("already")
        ? "Un compte existe déjà avec cet email."
        : "Création du compte impossible.";
      return fail(req, 409, "conflict", message);
    }
    // Le trigger handle_new_user a créé le profil ; on fiabilise les noms.
    await supabase
      .from("users")
      .update({ first_name: firstName || null, last_name: lastName || null })
      .eq("id", created.user.id);

    // Le mot de passe n'est retourné QU'ICI, une seule fois, à l'admin plateforme.
    return json(req, 201, { user_id: created.user.id, email, password });
  }

  if (action === "set_password") {
    const userId = typeof body?.user_id === "string" ? body.user_id : "";
    if (!userId) return fail(req, 400, "bad_request", "user_id requis.");
    const password = generatePassword();
    const { error } = await supabase.auth.admin.updateUserById(userId, { password });
    if (error) return fail(req, 404, "not_found", "Compte introuvable.");
    return json(req, 200, { user_id: userId, password });
  }

  if (action === "delete_user") {
    const userId = typeof body?.user_id === "string" ? body.user_id : "";
    if (!userId) return fail(req, 400, "bad_request", "user_id requis.");
    if (userId === caller.id) {
      return fail(req, 400, "bad_request", "Impossible de supprimer son propre compte.");
    }
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) return fail(req, 404, "not_found", "Compte introuvable.");
    return json(req, 200, { deleted: userId });
  }

  return fail(req, 400, "bad_request", "action inconnue (create_user, set_password, delete_user).");
});
