// Avis automatiques à l'usager (B12) — le quatrième facteur de `notifications-mailer`.
//
// La file est `citizen_notices`, remplie par le trigger t41 (changement de
// statut) : un FAIT par ligne, jamais une décision. Tout se décide ICI, au
// moment d'envoyer, dans cet ordre (ADR-6) — et chaque renoncement écrit sa
// raison sur la ligne, ce qui répond à « pourquoi n'ai-je rien reçu ? » :
//
//   1. l'interrupteur de la collectivité, relu (raison `interrupteur`) ;
//   2. l'accusé de réception passe d'abord : report d'une minute, sans
//      consommer de tentative ;
//   3. l'événement POUR L'USAGER : statut courant contre statut connu
//      (`citizenEventFor`), puis LA règle de décision (`shouldSend`) ;
//   4. le relais d'envoi ;
//   5. le canal (`citizenChannel`) : compte d'abord, invité ensuite, la
//      préférence du canal retenu, l'adresse ;
//   6. composition (`statusNoticeEmail`), trace dans `request_emails`
//      (`nature = 'avis'`, sans agent), envoi, statut connu avancé.
//
// ⚠️ Jamais l'adresse ni le contenu dans les journaux : la référence suffit.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { SmtpConfig } from "../_shared/email/config.ts";
import { sendBrandedEmail } from "../_shared/email/transport.ts";
import { usagerBrand } from "../_shared/email/usager.ts";
import { recipientIdentity } from "../_shared/email/destinataire.ts";
import { charteFor, socleContactIdentity } from "../_shared/email/socleUsager.ts";
import { accessEmailHash, pepperFrom } from "../_shared/access/accessCode.ts";
import { citizenEventFor } from "../_shared/citizenNotices/events.ts";
import { shouldSend, type SkipReason } from "../_shared/citizenNotices/decision.ts";
import { citizenChannel } from "../_shared/citizenNotices/channel.ts";
import { unsubscribeToken, unsubscribeUrl } from "../_shared/citizenNotices/unsubscribe.ts";
import { statusNoticeEmail, type NoticeEvent } from "../_shared/email/avisUsager.ts";

const LOG = "[mailer:avis-usager]";

export interface ClaimedNotice {
  notice_id: string;
  notice_org_id: string;
  organization_name: string | null;
  socle_root_org_id: string | null;
  request_id: string;
  reference: string;
  status: string;
  source: string;
  citizen_visible: boolean;
  closed_at: string | null;
  procedure_name: string | null;
  socle_procedure_id: string | null;
  socle_scope_org_id: string | null;
  socle_contact_id: string | null;
  requester_snapshot: unknown;
  identity_status: string;
  known_status: string | null;
  receipt_status: string | null;
  enabled: boolean;
  guest_email_hash: string | null;
  guest_tracking_url: string | null;
  guest_revoked_at: string | null;
  guest_notify_email: boolean | null;
  link_space_active: boolean | null;
  link_channel_prefs: Record<string, unknown> | null;
  link_account_email_hash: string | null;
  link_space_url: string | null;
  link_request_url_template: string | null;
  email_id: string | null;
  email_to: string | null;
  attempts: number;
}

export interface NoticeSecrets {
  /** `IRIS_ACCESS_CODE_PEPPER` : empreintes des adresses (accès invité, compte). */
  pepper: string | undefined;
  /** `IRIS_CITIZEN_TOKEN_SECRET` : clé dont dérive le jeton de désinscription. */
  tokenSecret: string | undefined;
}

export interface NoticeCounters {
  claimed: number;
  sent: number;
  skipped: number;
  deferred: number;
  failed: number;
}

export async function drainCitizenNotices(
  supabase: SupabaseClient,
  smtpFor: (orgId: string) => Promise<SmtpConfig | null>,
  batch: number,
  secrets: NoticeSecrets,
  now: () => Date = () => new Date(),
): Promise<NoticeCounters> {
  const counters: NoticeCounters = { claimed: 0, sent: 0, skipped: 0, deferred: 0, failed: 0 };
  const { data, error } = await supabase.rpc("claim_citizen_notices", { p_limit: batch });
  if (error) {
    console.error(`${LOG} claim : ${error.message}`);
    return counters;
  }
  const rows = (data ?? []) as ClaimedNotice[];
  counters.claimed = rows.length;

  const rpc = async (name: string, params: Record<string, unknown>) => {
    const { error: e } = await supabase.rpc(name, params);
    if (e) console.error(`${LOG} ${name} : ${e.message}`);
  };
  const skip = async (row: ClaimedNotice, reason: SkipReason, event: string | null, target: string | null = null) => {
    await rpc("skip_citizen_notice", { p_id: row.notice_id, p_reason: reason, p_event: event, p_target: target });
    counters.skipped++;
  };
  const fail = async (row: ClaimedNotice, message: string, event: string | null, target: string | null = null) => {
    console.error(`${LOG} ${row.reference} (tentative ${row.attempts}) : ${message}`);
    await rpc("settle_citizen_notice", { p_id: row.notice_id, p_ok: false, p_error: message, p_event: event, p_target: target });
    counters.failed++;
  };

  const pepper = pepperFrom(secrets.pepper);
  const hashEmail = pepper === null ? null : (email: string) => accessEmailHash(pepper, email);

  for (const row of rows) {
    if (!row.enabled) {
      await skip(row, "interrupteur", null);
      continue;
    }
    if (row.receipt_status === "pending" || row.receipt_status === "sending") {
      await rpc("defer_citizen_notice", { p_id: row.notice_id });
      counters.deferred++;
      continue;
    }

    const event = citizenEventFor(row.known_status, row.status);
    const decision = shouldSend({ event, organizationId: row.notice_org_id, socleProcedureId: row.socle_procedure_id });
    if (!decision.send) {
      await skip(row, decision.reason, event);
      continue;
    }

    const smtp = await smtpFor(row.notice_org_id);
    if (!smtp) {
      await skip(row, "pas_de_relais", event);
      continue;
    }

    // La fiche du jour ne se lit que s'il y a un espace à comparer.
    let liveEmail: string | null | undefined = null;
    if (row.link_space_active && row.socle_contact_id && row.identity_status !== "anonyme") {
      const live = await socleContactIdentity(row.socle_contact_id, row.socle_root_org_id, LOG);
      liveEmail = live === undefined ? undefined : live.email;
    }

    const channel = await citizenChannel({
      requestId: row.request_id,
      source: row.source,
      citizenVisible: row.citizen_visible,
      closedAt: row.closed_at,
      now: now(),
      liveEmail,
      link: row.link_space_active === null ? null : {
        spaceActive: row.link_space_active,
        channelPrefs: row.link_channel_prefs,
        accountEmailHash: row.link_account_email_hash,
        spaceUrl: row.link_space_url,
        requestUrlTemplate: row.link_request_url_template,
      },
      guest: row.guest_email_hash === null ? null : {
        emailHash: row.guest_email_hash,
        trackingUrl: row.guest_tracking_url,
        revokedAt: row.guest_revoked_at,
        notifyEmail: row.guest_notify_email,
        declaredEmail: recipientIdentity(row.requester_snapshot, row.identity_status).email,
      },
      hashEmail,
      respectPreference: true,
    });
    if (!channel.ok) {
      if ("retry" in channel) await fail(row, channel.retry, event);
      else await skip(row, channel.reason, event);
      continue;
    }

    // Sans désinscription possible, l'avis ne part pas (CCTP 5.4) : c'est une
    // erreur de configuration, lisible comme un échec.
    const secret = (secrets.tokenSecret ?? "").trim();
    if (secret.length < 32) {
      await fail(row, "secret des jetons usager absent : désinscription impossible", event, channel.target);
      continue;
    }
    const token = await unsubscribeToken(secret, {
      requestId: row.request_id,
      channel: "email",
      target: channel.target === "invite" ? { kind: "invite" } : { kind: "compte", contactId: row.socle_contact_id! },
    });
    const unsubscribe = unsubscribeUrl(channel.url, token);

    const notice = statusNoticeEmail({
      event: event as NoticeEvent,
      status: row.status,
      reference: row.reference,
      procedureName: row.procedure_name,
      url: channel.url,
      unsubscribeUrl: unsubscribe,
      tenantName: row.organization_name,
    });

    // Une reprise renvoie à l'adresse déjà tracée : l'échange dit où c'est parti.
    const to = row.email_id && row.email_to ? row.email_to : channel.to;
    if (!row.email_id) {
      const { data: emailId, error: startError } = await supabase.rpc("start_citizen_notice_email", {
        p_id: row.notice_id,
        p_to_email: to,
        p_subject: notice.subject,
        p_body: notice.body,
      });
      if (startError || typeof emailId !== "string") {
        await fail(row, "échange non enregistré", event, channel.target);
        continue;
      }
    }

    try {
      const charte = await charteFor(row.socle_scope_org_id, LOG);
      await sendBrandedEmail(
        smtp,
        to,
        notice.content,
        usagerBrand(row.organization_name, charte),
        [],
        unsubscribe ? { "List-Unsubscribe": `<${unsubscribe}>` } : {},
      );
    } catch (e) {
      await fail(row, e instanceof Error ? e.message : String(e), event, channel.target);
      continue;
    }
    await rpc("settle_citizen_notice", {
      p_id: row.notice_id,
      p_ok: true,
      p_error: null,
      p_event: event,
      p_target: channel.target,
      p_known_status: row.status,
    });
    counters.sent++;
  }
  return counters;
}
