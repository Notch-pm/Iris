// notifications-push — draine la boîte d'envoi PUSH des notifications et
// expédie les Web Push (VAPID) vers les appareils inscrits. Appelée par
// pg_cron toutes les minutes (motif notifications-mailer : en-tête
// `x-cron-secret` comparé au secret d'edge function ; aucune autre porte).
//
// Le push SUIT le canal in-app (décision PO 2026-09-10) : la base décide à
// l'insertion (`t10_notifications_push_queue`) si une ligne est à pousser —
// in-app ET au moins un appareil actif — et cette fonction n'est que le
// facteur. Cycle par notification : `claim_notification_pushes` réclame un lot
// ET le marque 'sending' atomiquement, avec les appareils du destinataire en
// JSON → un envoi par appareil → `decideOutcome` (envoyée dès qu'UN appareil a
// reçu ; 404/410 ⇒ `disable_push_subscription`) → `settle_notification_push`.
//
// ⚠️ CE QUI SORT : `_shared/push/message.ts` — jamais le corps d'une note,
// jamais l'usager, jamais le commentaire d'une intervention. Le texte passe
// chiffré de bout en bout (RFC 8291) : le service de push ne le lit pas.
//
// ⚠️ CORS : aucun. Cette fonction n'est jamais appelée depuis un navigateur.

import { createClient } from "npm:@supabase/supabase-js@2";
import { readVapid } from "../_shared/push/config.ts";
import { pushMessage } from "../_shared/push/message.ts";
import { decideOutcome, type DeliveryResult } from "../_shared/push/outcome.ts";
import { sendPush } from "../_shared/push/transport.ts";
import type { NotificationPayload } from "../_shared/email/notifications.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const APP_URL = (Deno.env.get("IRIS_APP_URL") ?? "http://localhost:5174").replace(/\/+$/, "");
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const VAPID = readVapid(Deno.env.toObject());

/** Taille de lot : une exécution par minute ; chaque ligne peut viser
 *  plusieurs appareils, envoyés en parallèle. */
const BATCH = 50;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

interface ClaimedSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface ClaimedRow {
  notification_id: string;
  organization_id: string;
  organization_name: string | null;
  kind: string;
  payload: NotificationPayload | null;
  request_id: string;
  attempts: number;
  subscriptions: ClaimedSubscription[] | null;
}

async function settle(id: string, ok: boolean, error?: string | null): Promise<void> {
  const { error: e } = await supabase.rpc("settle_notification_push", {
    p_id: id, p_ok: ok, p_error: error ?? undefined,
  });
  if (e) console.error(`[push] settle ${id} : ${e.message}`);
}

async function disable(subscriptionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("disable_push_subscription", { p_id: subscriptionId, p_reason: reason });
  if (error) console.error(`[push] disable ${subscriptionId} : ${error.message}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // Seule porte d'entrée : le secret du cron. Un secret non configuré côté
  // fonction ferme la porte au lieu de l'ouvrir.
  if (CRON_SECRET === "" || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json(401, { error: "unauthorized" });
  }

  // Sans clés VAPID on ne réclame RIEN : réclamer consommerait les tentatives
  // d'une file qu'on ne peut pas servir.
  if (!VAPID) {
    console.error("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT absents ou invalides");
    return json(503, { error: "not_configured" });
  }

  const { data, error } = await supabase.rpc("claim_notification_pushes", { p_limit: BATCH });
  if (error) {
    console.error(`[push] claim : ${error.message}`);
    return json(500, { error: "claim_failed" });
  }

  const rows = (data ?? []) as ClaimedRow[];
  if (rows.length === 0) return json(200, { claimed: 0, sent: 0, retried: 0, disabled: 0 });

  let sent = 0, retried = 0, disabled = 0;

  for (const row of rows) {
    const message = pushMessage({
      kind: row.kind,
      payload: row.payload,
      requestId: row.request_id,
      appUrl: APP_URL,
    });
    const body = JSON.stringify({ ...message, id: row.notification_id });
    const targets = row.subscriptions ?? [];

    const results: DeliveryResult[] = await Promise.all(targets.map(async (sub) => {
      const r = await sendPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, body, VAPID);
      return { subscriptionId: sub.id, status: r.status, error: r.error };
    }));

    const outcome = decideOutcome(results);
    for (const id of outcome.disable) {
      const r = results.find((x) => x.subscriptionId === id);
      await disable(id, `HTTP ${r?.status ?? "?"}`);
      disabled++;
    }

    if (outcome.settle === "sent") {
      await settle(row.notification_id, true);
      sent++;
    } else {
      // ⚠️ Jamais l'endpoint ni le texte dans les journaux : l'identifiant de
      // la notification suffit à retrouver la ligne.
      console.error(`[push] ${row.notification_id} (tentative ${row.attempts}) : ${outcome.error}`);
      await settle(row.notification_id, false, outcome.error);
      retried++;
    }
  }

  return json(200, { claimed: rows.length, sent, retried, disabled });
});
