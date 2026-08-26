// notifications-mailer — draine la boîte d'envoi des notifications et expédie
// les e-mails. Appelée par pg_cron toutes les minutes (motif
// sync-socle-referentiel : en-tête `x-cron-secret` comparé au secret d'edge
// function ; aucune autre porte d'entrée).
//
// Pourquoi une fonction et pas un envoi depuis le déclencheur : un appel SMTP
// dans la transaction métier la ferait traîner (le relais met des secondes) et
// la ferait ÉCHOUER quand le relais est indisponible — on n'annule pas une
// affectation parce qu'un serveur de mail tousse. La ligne `notifications` est
// donc une boîte d'envoi, et cette fonction en est le facteur.
//
// Cycle par message : `claim_notification_emails` réclame un lot ET le marque
// 'sending' ATOMIQUEMENT (deux exécutions concurrentes ne peuvent pas expédier
// deux fois) → envoi → `settle_notification_email` (succès, ou retour en file
// avec temporisation croissante, puis abandon franc). Un destinataire sans
// adresse ou un tenant sans relais → `skip_notification_email` : on ne
// réessaiera jamais avec succès, autant le dire.
//
// ⚠️ CORS : aucun. Cette fonction n'est jamais appelée depuis un navigateur.

import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveSmtp, type SmtpConfig, type SmtpRow } from "../_shared/email/config.ts";
import { sendBrandedEmail } from "../_shared/email/transport.ts";
import {
  brandFor,
  notificationEmail,
  requestPermalink,
  type NotificationPayload,
} from "../_shared/email/notifications.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const APP_URL = (Deno.env.get("IRIS_APP_URL") ?? "http://localhost:5174").replace(/\/+$/, "");
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

/** Taille de lot : une exécution par minute, on reste largement sous la limite
 *  de temps d'une edge function même avec un relais lent. */
const BATCH = 25;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

interface ClaimedRow {
  notification_id: string;
  organization_id: string;
  organization_name: string | null;
  kind: string;
  payload: NotificationPayload | null;
  request_id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  attempts: number;
}

/** Une adresse par tenant : le relais est résolu une fois, pas par message. */
async function smtpForOrg(
  orgId: string,
  cache: Map<string, SmtpConfig | null>,
): Promise<SmtpConfig | null> {
  if (cache.has(orgId)) return cache.get(orgId)!;
  const { data, error } = await supabase.rpc("smtp_config_for_org", { p_org_id: orgId });
  if (error) {
    console.error(`[mailer] smtp_config_for_org(${orgId}) : ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as SmtpRow | null | undefined;
  // Repli plateforme si le tenant n'a pas de relais propre (resolveSmtp).
  const config = resolveSmtp(row ?? null, Deno.env.toObject());
  cache.set(orgId, config);
  return config;
}

async function settle(id: string, ok: boolean, error?: string): Promise<void> {
  const { error: rpcError } = await supabase.rpc("settle_notification_email", {
    p_id: id,
    p_ok: ok,
    p_error: error ?? null,
  });
  if (rpcError) console.error(`[mailer] settle(${id}) : ${rpcError.message}`);
}

async function skip(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("skip_notification_email", { p_id: id, p_reason: reason });
  if (error) console.error(`[mailer] skip(${id}) : ${error.message}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // Seule porte d'entrée : le secret du cron. Un secret non configuré côté
  // fonction ferme la porte au lieu de l'ouvrir.
  if (CRON_SECRET === "" || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json(401, { error: "unauthorized" });
  }

  const { data, error } = await supabase.rpc("claim_notification_emails", { p_limit: BATCH });
  if (error) {
    console.error(`[mailer] claim : ${error.message}`);
    return json(500, { error: "claim_failed" });
  }

  const rows = (data ?? []) as ClaimedRow[];
  if (rows.length === 0) return json(200, { claimed: 0, sent: 0, skipped: 0, failed: 0 });

  const smtpCache = new Map<string, SmtpConfig | null>();
  let sent = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const to = (row.recipient_email ?? "").trim();
    if (to === "") {
      await skip(row.notification_id, "destinataire sans adresse");
      skipped++;
      continue;
    }

    const config = await smtpForOrg(row.organization_id, smtpCache);
    if (!config) {
      // Ni relais de tenant, ni relais de plateforme : réessayer ne servira à
      // rien tant que la configuration n'a pas changé.
      await skip(row.notification_id, "aucun serveur d'envoi configuré");
      skipped++;
      continue;
    }

    const content = notificationEmail({
      kind: row.kind,
      payload: row.payload ?? {},
      recipientName: row.recipient_name,
      tenantName: row.organization_name,
      requestUrl: requestPermalink(APP_URL, row.request_id),
    });

    try {
      await sendBrandedEmail(config, to, content, brandFor(row.organization_name));
      await settle(row.notification_id, true);
      sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // ⚠️ Jamais l'adresse ni le contenu dans les journaux : l'identifiant de
      // la notification suffit à retrouver la ligne.
      console.error(`[mailer] envoi ${row.notification_id} (tentative ${row.attempts}) : ${message}`);
      await settle(row.notification_id, false, message);
      failed++;
    }
  }

  return json(200, { claimed: rows.length, sent, skipped, failed });
});
