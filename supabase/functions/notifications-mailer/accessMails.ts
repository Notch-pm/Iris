// Nouveaux codes d'accès invité — le troisième facteur de `notifications-mailer`.
//
// La file est `request_access_mails` (migration 20261021090000), remplie par
// le « code perdu » du portail (`requests-api`) et par un agent
// (`request-guest-access`). L'adresse et le code arrivent EN CLAIR de la file,
// qui les oublie au règlement : l'adresse a déjà été vérifiée contre
// l'empreinte de l'adresse déclarée au dépôt, AVANT d'entrer dans la file.
//
// Même discipline que les accusés (`receipts.ts`) : l'échange enregistré
// (onglet Échanges) est ouvert AVANT l'envoi, avec le code MASQUÉ ; sur une
// reprise, on renvoie le texte enregistré.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { SmtpConfig } from "../_shared/email/config.ts";
import { sendBrandedEmail } from "../_shared/email/transport.ts";
import { usagerBrand, usagerEmailContent } from "../_shared/email/usager.ts";
import { revealAccessCode } from "../_shared/email/accuse.ts";
import { accessCodeEmail } from "../_shared/email/codeAcces.ts";
import { charteFor } from "../_shared/email/socleUsager.ts";

const LOG = "[mailer:code]";

interface ClaimedAccessMail {
  mail_id: string;
  request_id: string;
  organization_id: string;
  organization_name: string | null;
  socle_scope_org_id: string | null;
  reference: string;
  subject: string | null;
  reason: "renvoi_usager" | "agent";
  requested_by: string | null;
  to_email: string | null;
  access_code: string | null;
  tracking_url: string | null;
  email_id: string | null;
  email_subject: string | null;
  email_body: string | null;
  attempts: number;
}

export interface AccessMailCounters {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

export async function drainAccessMails(
  supabase: SupabaseClient,
  smtpFor: (orgId: string) => Promise<SmtpConfig | null>,
  batch: number,
): Promise<AccessMailCounters> {
  const counters: AccessMailCounters = { claimed: 0, sent: 0, skipped: 0, failed: 0 };
  const { data, error } = await supabase.rpc("claim_request_access_mails", { p_limit: batch });
  if (error) {
    console.error(`${LOG} claim : ${error.message}`);
    return counters;
  }
  const rows = (data ?? []) as ClaimedAccessMail[];
  counters.claimed = rows.length;

  const skip = async (id: string, reason: string) => {
    const { error: e } = await supabase.rpc("skip_request_access_mail", { p_mail_id: id, p_reason: reason });
    if (e) console.error(`${LOG} skip(${id}) : ${e.message}`);
    counters.skipped++;
  };
  const settle = async (id: string, ok: boolean, reason?: string) => {
    const { error: e } = await supabase.rpc("settle_request_access_mail", {
      p_mail_id: id,
      p_ok: ok,
      p_error: reason ?? null,
    });
    if (e) console.error(`${LOG} settle(${id}) : ${e.message}`);
  };

  for (const row of rows) {
    const to = (row.to_email ?? "").trim();
    if (to === "" || !row.access_code) {
      // Le clair a été effacé (règlement concurrent) : rien d'utile à envoyer.
      await skip(row.mail_id, "adresse ou code absent");
      continue;
    }
    const smtp = await smtpFor(row.organization_id);
    if (!smtp) {
      await skip(row.mail_id, "aucun serveur d'envoi configuré");
      continue;
    }

    let subject = row.email_subject ?? "";
    let body = row.email_body ?? "";
    if (!row.email_id) {
      const composed = accessCodeEmail({
        reference: row.reference,
        requestSubject: row.subject,
        trackingUrl: row.tracking_url,
        tenantName: row.organization_name,
        reason: row.reason,
      });
      subject = composed.subject;
      body = composed.body;
      const { data: emailId, error: startError } = await supabase.rpc("start_request_access_mail_email", {
        p_mail_id: row.mail_id,
        p_subject: subject,
        p_body: body,
      });
      if (startError || typeof emailId !== "string") {
        console.error(`${LOG} échange non ouvert (${row.mail_id}) : ${startError?.message ?? "?"}`);
        await settle(row.mail_id, false, "échange non enregistré");
        counters.failed++;
        continue;
      }
    }

    try {
      const charte = await charteFor(row.socle_scope_org_id, LOG);
      await sendBrandedEmail(
        smtp,
        to,
        usagerEmailContent(subject, revealAccessCode(body, row.access_code)),
        usagerBrand(row.organization_name, charte),
      );
      await settle(row.mail_id, true);
      counters.sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // ⚠️ Jamais l'adresse ni le code dans les journaux.
      console.error(`${LOG} envoi ${row.reference} (tentative ${row.attempts}) : ${message}`);
      await settle(row.mail_id, false, message);
      counters.failed++;
    }
  }
  return counters;
}
