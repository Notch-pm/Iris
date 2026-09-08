// attachments-maintenance — l'entretien du bucket des pièces, sur cron.
//
// LA BASE DÉCIDE, CETTE FONCTION EXÉCUTE (motif notifications-mailer) : un
// objet du bucket ne se retire que par l'API Storage, jamais par un DELETE
// SQL — la base enfile (trigger t07, purge, réconciliation), ici on retire et
// on solde. Rien ici ne choisit ce qui doit partir.
//
// Deux modes :
//   · défaut (`sweep`, le cron) — 1) zone d'attente : les lignes expirées sans
//     rattachement ou retirées perdent leur objet puis leur ligne ; les lignes
//     consommées depuis plus de 30 jours perdent leur ligne seule ; 2) outbox :
//     un lot d'objets à retirer (404 = déjà parti = succès) ;
//   · `?mode=reconcile` (manuel) — compare le bucket à ce que la base connaît :
//     les objets que rien ne décrit vont à l'outbox (passé une heure de
//     grâce), les pièces sans objet passent en `copy_status = 'error'`.
//     Rapport JSON. Jamais planifié : c'est un filet, pas un rouage.
//
// Auth : en-tête `x-cron-secret` = secret CRON_SECRET. Aucun CORS : jamais
// appelée depuis un navigateur.

import { createClient } from "npm:@supabase/supabase-js@2";
import { planReconciliation, type KnownPath } from "../_shared/maintenance/plan.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BUCKET = "request-attachments";
const CONSUMED_RETENTION_DAYS = 30;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Retire un objet ; « introuvable » vaut succès (déjà parti). */
async function removeObject(path: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    if (/not found|does not exist/i.test(error.message)) return { ok: true };
    return { ok: false, error: error.message };
  }
  // `remove` rend la liste des objets retirés ; vide = il n'y était pas.
  void data;
  return { ok: true };
}

async function sweep(): Promise<Record<string, number | string>> {
  const counters: Record<string, number | string> = {
    uploads_expired: 0, uploads_purged: 0, uploads_failed: 0,
    consumed_rows_purged: 0,
    deletions_claimed: 0, deletions_done: 0, deletions_failed: 0,
  };

  // 1. Zone d'attente : objet puis ligne.
  const { data: expired, error: expiredError } = await supabase.rpc("expired_attachment_uploads", { p_limit: 100 });
  if (expiredError) {
    counters.error = `expired_attachment_uploads : ${expiredError.message}`;
    return counters;
  }
  for (const row of expired ?? []) {
    counters.uploads_expired = (counters.uploads_expired as number) + 1;
    const removed = await removeObject(row.storage_path);
    if (!removed.ok) {
      counters.uploads_failed = (counters.uploads_failed as number) + 1;
      console.error(`attachments-maintenance: objet non retiré ${row.storage_path} — ${removed.error}`);
      continue;
    }
    const { error } = await supabase.rpc("purge_attachment_upload", { p_id: row.id });
    if (error) {
      counters.uploads_failed = (counters.uploads_failed as number) + 1;
      console.error("attachments-maintenance: ligne d'attente non purgée", error);
      continue;
    }
    counters.uploads_purged = (counters.uploads_purged as number) + 1;
  }

  const { data: purgedConsumed } = await supabase.rpc("purge_consumed_uploads", { p_days: CONSUMED_RETENTION_DAYS });
  counters.consumed_rows_purged = typeof purgedConsumed === "number" ? purgedConsumed : 0;

  // 2. Outbox.
  const { data: claimed, error: claimError } = await supabase.rpc("claim_storage_deletions", { p_limit: 50 });
  if (claimError) {
    counters.error = `claim_storage_deletions : ${claimError.message}`;
    return counters;
  }
  for (const item of claimed ?? []) {
    counters.deletions_claimed = (counters.deletions_claimed as number) + 1;
    const removed = await removeObject(item.storage_path);
    await supabase.rpc("settle_storage_deletion", {
      p_id: item.id,
      p_ok: removed.ok,
      p_error: removed.ok ? null : removed.error,
    });
    if (removed.ok) counters.deletions_done = (counters.deletions_done as number) + 1;
    else counters.deletions_failed = (counters.deletions_failed as number) + 1;
  }
  return counters;
}

async function reconcile(): Promise<Record<string, unknown>> {
  const [{ data: objects, error: objectsError }, { data: known, error: knownError }] = await Promise.all([
    supabase.rpc("bucket_objects", { p_bucket: BUCKET }),
    supabase.rpc("attachment_known_paths"),
  ]);
  if (objectsError || knownError) {
    return { error: (objectsError ?? knownError)!.message };
  }
  const plan = planReconciliation({
    now: new Date(),
    objects: (objects ?? []).map((o) => ({ name: o.name, createdAt: o.created_at })),
    known: (known ?? []) as KnownPath[],
  });
  let enqueued = 0;
  for (const path of plan.orphans) {
    const org = path.split("/")[0] || null;
    const { error } = await supabase.rpc("enqueue_storage_deletion", { p_path: path, p_org: org, p_reason: "orphan" });
    if (!error) enqueued += 1;
  }
  let marked = 0;
  if (plan.missing.length > 0) {
    const { data } = await supabase.rpc("mark_attachments_missing", { p_paths: plan.missing });
    marked = typeof data === "number" ? data : 0;
  }
  return {
    objects: (objects ?? []).length,
    known_paths: (known ?? []).length,
    orphans_enqueued: enqueued,
    orphans: plan.orphans,
    missing_marked: marked,
    missing: plan.missing,
    deferred: plan.deferred,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: { code: "method_not_allowed", message: "POST attendu." } });
  if (CRON_SECRET === "" || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json(401, { error: { code: "unauthorized", message: "Secret cron absent ou invalide." } });
  }
  const mode = new URL(req.url).searchParams.get("mode") ?? "sweep";
  const started = Date.now();
  const result = mode === "reconcile" ? await reconcile() : await sweep();
  console.log(`attachments-maintenance ${mode}: ${JSON.stringify(result)} en ${Date.now() - started} ms`);
  return json(200, { mode, ...result });
});
