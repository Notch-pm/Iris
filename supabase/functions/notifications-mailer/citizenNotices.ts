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
// Depuis le lot L4c-3 (M2), une ligne peut aussi porter des MESSAGES publiés
// dans l'espace (`message_email_ids`). Leur avis n'est pas désactivable et part
// à l'adresse FIGÉE du message, qu'un canal voit ; un statut de la même
// fenêtre est annoncé dans le MÊME courriel (`messageNoticeEmail`).
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
import { shouldSend, type Decision, type SkipReason } from "../_shared/citizenNotices/decision.ts";
import { citizenChannel, spaceRequestUrl } from "../_shared/citizenNotices/channel.ts";
import { unsubscribeToken, unsubscribeUrl } from "../_shared/citizenNotices/unsubscribe.ts";
import { messageExcerpt, messageNoticeEmail, statusNoticeEmail, type NoticeEvent } from "../_shared/email/avisUsager.ts";

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
  /** Messages publiés dans l'espace (M2) que cet avis annonce. */
  message_email_ids: string[] | null;
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

interface PublishedMessage {
  id: string;
  to_email: string;
  body: string | null;
  sent_at: string | null;
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
    const messageIds = row.message_email_ids ?? [];
    const hasMessages = messageIds.length > 0;

    // Un message déjà publié doit être annoncé : l'interrupteur, relu, ne fait
    // taire que les statuts (ADR-10).
    if (!row.enabled && !hasMessages) {
      await skip(row, "interrupteur", null);
      continue;
    }
    if (row.receipt_status === "pending" || row.receipt_status === "sending") {
      await rpc("defer_citizen_notice", { p_id: row.notice_id });
      counters.deferred++;
      continue;
    }

    const event = citizenEventFor(row.known_status, row.status);
    const decision: Decision = row.enabled
      ? shouldSend({ event, organizationId: row.notice_org_id, socleProcedureId: row.socle_procedure_id })
      : { send: false, reason: "interrupteur" };
    if (!decision.send && !hasMessages) {
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
    const channelOf = (respectPreference: boolean) => citizenChannel({
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
      respectPreference,
    });

    // ---- La partie statut : préférence du canal respectée -------------------
    let statusChannel: Awaited<ReturnType<typeof citizenChannel>> | null = null;
    if (decision.send) {
      statusChannel = await channelOf(true);
      if (!statusChannel.ok && "retry" in statusChannel) {
        await fail(row, statusChannel.retry, event);
        continue;
      }
    }
    const withStatus = statusChannel?.ok === true;

    // ---- La partie message : non désactivable, à l'adresse FIGÉE du message --
    let messages: PublishedMessage[] = [];
    if (hasMessages) {
      const { data: found, error: messagesError } = await supabase.from("request_emails")
        .select("id, to_email, body, sent_at").in("id", messageIds);
      if (messagesError) {
        await fail(row, "messages illisibles", event);
        continue;
      }
      messages = ((found ?? []) as PublishedMessage[])
        .filter((m) => typeof m.to_email === "string" && m.to_email.trim() !== "")
        .sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? ""));
    }
    const last = messages[messages.length - 1] ?? null;

    if (!withStatus && last === null) {
      const reason: SkipReason = !decision.send
        ? decision.reason
        : statusChannel && !statusChannel.ok && "reason" in statusChannel ? statusChannel.reason : "aucun_acces_en_ligne";
      await skip(row, reason, event);
      continue;
    }

    // Le lien : celui du canal ; pour un message dont l'accès a été coupé dans
    // la fenêtre, le dernier lien connu (risque accepté, § 6 de l'architecture).
    let target: "compte" | "invite";
    let url: string;
    let to: string;
    if (last !== null) {
      const channel = statusChannel?.ok ? statusChannel : await channelOf(false);
      if (channel.ok) {
        target = channel.target;
        url = channel.url;
      } else if ("retry" in channel) {
        await fail(row, channel.retry, event);
        continue;
      } else {
        const fallback = row.guest_tracking_url ?? (row.link_space_url
          ? spaceRequestUrl({
            spaceActive: true, channelPrefs: null, accountEmailHash: null,
            spaceUrl: row.link_space_url, requestUrlTemplate: row.link_request_url_template,
          }, row.request_id)
          : null);
        if (fallback === null) {
          await skip(row, channel.reason, event);
          continue;
        }
        target = row.guest_tracking_url ? "invite" : "compte";
        url = fallback;
      }
      to = last.to_email;
    } else {
      const channel = statusChannel as Extract<typeof statusChannel, { ok: true }>;
      target = channel.target;
      url = channel.url;
      to = channel.to;
    }

    // Sans désinscription possible, l'avis ne part pas (CCTP 5.4) : c'est une
    // erreur de configuration, lisible comme un échec.
    const secret = (secrets.tokenSecret ?? "").trim();
    if (secret.length < 32) {
      await fail(row, "secret des jetons usager absent : désinscription impossible", event, target);
      continue;
    }
    if (target === "compte" && !row.socle_contact_id) {
      await skip(row, "aucun_acces_en_ligne", event);
      continue;
    }
    const token = await unsubscribeToken(secret, {
      requestId: row.request_id,
      channel: "email",
      target: target === "invite" ? { kind: "invite" } : { kind: "compte", contactId: row.socle_contact_id! },
    });
    // Seul un avis qui annonce un STATUT se désinscrit : l'avis de message ne
    // se coupe pas (décision PO n° 1) — ni lien en pied, ni List-Unsubscribe.
    const unsubscribe = withStatus ? unsubscribeUrl(url, token) : null;

    const statusPart = withStatus ? { event: event as NoticeEvent, status: row.status } : null;
    const notice = last !== null
      ? messageNoticeEmail({
        reference: row.reference,
        procedureName: row.procedure_name,
        excerpt: messageExcerpt(last.body ?? ""),
        messageCount: messages.length,
        statusPart,
        url,
        unsubscribeUrl: unsubscribe,
        tenantName: row.organization_name,
        closed: row.closed_at !== null,
      })
      : statusNoticeEmail({
        event: event as NoticeEvent,
        status: row.status,
        reference: row.reference,
        procedureName: row.procedure_name,
        url,
        unsubscribeUrl: unsubscribe,
        tenantName: row.organization_name,
      });
    const eventSent = withStatus ? event : "nouveau_message";

    // Une reprise renvoie à l'adresse déjà tracée : l'échange dit où c'est parti.
    if (row.email_id && row.email_to) to = row.email_to;
    if (!row.email_id) {
      const { data: emailId, error: startError } = await supabase.rpc("start_citizen_notice_email", {
        p_id: row.notice_id,
        p_to_email: to,
        p_subject: notice.subject,
        p_body: notice.body,
      });
      if (startError || typeof emailId !== "string") {
        await fail(row, "échange non enregistré", eventSent, target);
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
        // RFC 8058 : le client de messagerie POSTE `List-Unsubscribe=One-Click`
        // à la même adresse ; le portail (Worker de Nora) relaie ce POST.
        unsubscribe
          ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
          : {},
      );
    } catch (e) {
      await fail(row, e instanceof Error ? e.message : String(e), eventSent, target);
      continue;
    }
    await rpc("settle_citizen_notice", {
      p_id: row.notice_id,
      p_ok: true,
      p_error: null,
      p_event: eventSent,
      p_target: target,
      // Le statut n'est CONNU que s'il a été annoncé.
      p_known_status: withStatus ? row.status : null,
    });
    counters.sent++;
  }
  return counters;
}
