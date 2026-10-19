// Accusés de réception à l'usager — le second facteur de `notifications-mailer`.
//
// La file est `request_receipts`, remplie au DÉPÔT par `create-request-from-
// procedure` et `requests-api` (Clara exclue en SQL). Elle partage le cron, le
// relais et la discipline de la boîte d'envoi des notifications ; le reste est
// celui d'un message à l'USAGER, comme l'avis de clôture de `send-request-email` :
//
//   · destinataire résolu ICI — fiche Socle relue, snapshot du dépôt en repli ;
//     aucune adresse (dépôt anonyme, identité sans courriel) ⇒ on renonce, et
//     rien n'apparaît dans l'onglet Échanges, puisque rien n'est parti ;
//   · message composé ICI (`_shared/email/accuse.ts`), aux couleurs de la
//     collectivité porteuse (charte lue chez le Socle, jamais bloquante) ;
//   · trace dans `request_emails`, ouverte AVANT l'envoi, sans agent
//     (`sent_by` NULL). Sur une reprise, on renvoie le texte ENREGISTRÉ ;
//   · code d'accès invité (suivi en ligne) : l'échange enregistré n'en garde
//     qu'un masque ; le clair vient de la file, qui l'oublie au règlement.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { SmtpConfig } from "../_shared/email/config.ts";
import { sendBrandedEmail } from "../_shared/email/transport.ts";
import { usagerBrand, usagerEmailContent } from "../_shared/email/usager.ts";
import { receiptEmail, revealAccessCode } from "../_shared/email/accuse.ts";
import { recipientIdentity } from "../_shared/email/destinataire.ts";
import { charteFor, socleContactIdentity } from "../_shared/email/socleUsager.ts";

const LOG = "[mailer:accuse]";

interface ClaimedReceipt {
  receipt_request_id: string;
  receipt_org_id: string;
  organization_name: string | null;
  socle_root_org_id: string | null;
  socle_scope_org_id: string | null;
  socle_contact_id: string | null;
  requester_snapshot: unknown;
  identity_status: string;
  reference: string;
  subject: string | null;
  organisme: string | null;
  received_at: string | null;
  email_id: string | null;
  email_to: string | null;
  email_subject: string | null;
  email_body: string | null;
  attempts: number;
  /** Code d'accès invité EN CLAIR (suivi en ligne accepté au dépôt) — jamais enregistré dans l'échange. */
  access_code: string | null;
  tracking_url: string | null;
}

export interface ReceiptCounters {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

export async function drainReceipts(
  supabase: SupabaseClient,
  smtpFor: (orgId: string) => Promise<SmtpConfig | null>,
  batch: number,
): Promise<ReceiptCounters> {
  const counters: ReceiptCounters = { claimed: 0, sent: 0, skipped: 0, failed: 0 };
  const { data, error } = await supabase.rpc("claim_request_receipts", { p_limit: batch });
  if (error) {
    console.error(`${LOG} claim : ${error.message}`);
    return counters;
  }
  const rows = (data ?? []) as ClaimedReceipt[];
  counters.claimed = rows.length;

  const skip = async (id: string, reason: string) => {
    const { error: e } = await supabase.rpc("skip_request_receipt", { p_request_id: id, p_reason: reason });
    if (e) console.error(`${LOG} skip(${id}) : ${e.message}`);
    counters.skipped++;
  };
  const settle = async (id: string, ok: boolean, reason?: string) => {
    const { error: e } = await supabase.rpc("settle_request_receipt", {
      p_request_id: id,
      p_ok: ok,
      p_error: reason ?? null,
    });
    if (e) console.error(`${LOG} settle(${id}) : ${e.message}`);
  };

  for (const row of rows) {
    const id = row.receipt_request_id;

    const smtp = await smtpFor(row.receipt_org_id);
    if (!smtp) {
      await skip(id, "aucun serveur d'envoi configuré");
      continue;
    }

    // ---- Ce qui part : l'échange déjà ouvert, sinon un message composé ici --
    let to = (row.email_to ?? "").trim();
    let subject = row.email_subject ?? "";
    let body = row.email_body ?? "";

    if (!row.email_id) {
      let who = recipientIdentity(row.requester_snapshot, row.identity_status);
      if (row.socle_contact_id && row.identity_status !== "anonyme") {
        // `undefined` = référentiel muet : on garde le dépôt plutôt que de
        // renoncer. Une fiche LUE sans adresse vaut réponse.
        const live = await socleContactIdentity(row.socle_contact_id, row.socle_root_org_id, LOG);
        if (live !== undefined) who = live;
      }
      to = (who.email ?? "").trim();
      if (to === "") {
        await skip(id, "aucune adresse de courriel");
        continue;
      }
      const composed = receiptEmail({
        reference: row.reference,
        requestSubject: row.subject,
        receivedAt: row.received_at,
        organisme: row.organisme,
        recipient: { civility: who.civility, fullName: who.fullName },
        tenantName: row.organization_name,
        access: row.access_code ? { trackingUrl: row.tracking_url } : null,
      });
      subject = composed.subject;
      body = composed.body;

      const { data: emailId, error: startError } = await supabase.rpc("start_request_receipt_email", {
        p_request_id: id,
        p_to_email: to,
        p_subject: subject,
        p_body: body,
      });
      if (startError || typeof emailId !== "string") {
        // Rien n'est parti : on retentera, sans trace orpheline.
        console.error(`${LOG} échange non ouvert (${id}) : ${startError?.message ?? "?"}`);
        await settle(id, false, "échange non enregistré");
        counters.failed++;
        continue;
      }
    }

    try {
      const charte = await charteFor(row.socle_scope_org_id, LOG);
      await sendBrandedEmail(
        smtp,
        to,
        // L'échange enregistré porte le code MASQUÉ ; seul le message envoyé porte le clair.
        usagerEmailContent(subject, revealAccessCode(body, row.access_code)),
        usagerBrand(row.organization_name, charte),
      );
      await settle(id, true);
      counters.sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // ⚠️ Jamais l'adresse ni le contenu dans les journaux.
      console.error(`${LOG} envoi ${row.reference} (tentative ${row.attempts}) : ${message}`);
      await settle(id, false, message);
      counters.failed++;
    }
  }
  return counters;
}
