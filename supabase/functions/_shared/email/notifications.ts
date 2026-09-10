// Catalogue des e-mails de notification d'Iris — un objet par motif.
// Module PUR (aucune dépendance Deno, aucun réseau) — testé par vitest.
//
// ⚠️ CE QUI SORT D'IRIS. Un e-mail quitte le périmètre applicatif : il part
// chez un fournisseur de messagerie, se retrouve sur un téléphone, se
// transfère. On n'y met donc QUE ce qui permet de reconnaître la demande et de
// décider si elle demande une action :
//
//   ✅ référence, objet de la demande, démarche, destinataire, statuts, auteur
//      du geste, permalien.
//   ❌ le CORPS des notes internes (invariant : elles ne quittent jamais Iris),
//      l'identité de l'usager, la description de la demande, les pièces.
//
// Le permalien porte le reste : qui veut le détail ouvre la fiche, où le RLS
// s'applique. C'est ce qui permet d'envoyer ces messages sans transformer la
// messagerie en second système d'information.

import { brandLine, PRODUCT_NAME, type EmailBrand, type EmailContent } from "./template.ts";

export type NotificationKind =
  | "assigned"
  | "unassigned"
  | "status_changed"
  | "note_added"
  | "mentioned"
  | "new_request_in_scope"
  | "transferred_in"
  | "intervention_requested"
  | "intervention_completed";

/** Libellés de statut — copie assumée de `src/features/requests/statuts.ts`.
 *  Les edge functions ne partagent pas le graphe de modules du front ; un
 *  statut inconnu s'affiche tel quel plutôt que de faire échouer un envoi. */
export const STATUS_LABELS: Record<string, string> = {
  a_traiter: "À traiter",
  en_instruction: "En cours d'instruction",
  en_attente: "En attente d'information",
  annulee: "Annulée",
  resolue_positive: "Résolue positivement",
  resolue_negative: "Résolue négativement",
  archivee: "Archivée",
};

export function statusLabel(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (v === "") return "—";
  return STATUS_LABELS[v] ?? v;
}

/** Ce que le déclencheur a figé dans `notifications.payload`. */
export interface NotificationPayload {
  reference?: string | null;
  subject?: string | null;
  actor_name?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  motif?: string | null;
  source?: string | null;
  procedure?: string | null;
  destinataire?: string | null;
  reassigned?: boolean | null;
  /** Transfert : l'organisme QUITTÉ (`destinataire` porte celui d'arrivée). */
  from_destinataire?: string | null;
  /** Transfert : date de dépôt de la demande (ISO), figée au moment du geste. */
  received_at?: string | null;
  /** Intervention : jour souhaité par l'agent (`AAAA-MM-JJ`). */
  requested_for?: string | null;
  /** Intervention : jour de finalisation déclaré par l'intervenant (`AAAA-MM-JJ`). */
  completed_on?: string | null;
  /** Intervention réalisée : nom de l'intervenant, figé dans le payload. */
  intervenant_name?: string | null;
  /**
   * Intervention : le commentaire de la sollicitation (ce qui est attendu) ou
   * de la réalisation. Il SORT dans l'e-mail : c'est la consigne écrite POUR
   * son destinataire, pas une note interne — et sans elle le message ne
   * dirait pas quoi faire.
   */
  comment?: string | null;
  /** Intervention réalisée : nombre de justificatifs joints à la fiche (jamais les fichiers eux-mêmes). */
  attachments?: number | null;
}

export interface NotificationEmailInput {
  kind: string;
  payload: NotificationPayload;
  /** Nom affichable du destinataire, pour la salutation. */
  recipientName?: string | null;
  /** Tenant, pour le bandeau et le pied. */
  tenantName?: string | null;
  /** Permalien vers la fiche — déjà construit par l'appelant. */
  requestUrl: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function greeting(recipientName?: string | null): string {
  const name = text(recipientName);
  return name ? `Bonjour ${name},` : "Bonjour,";
}

/** L'auteur du geste, ou l'origine quand personne ne l'a fait (ingestion). */
function actor(payload: NotificationPayload): string {
  const name = text(payload.actor_name);
  if (name) return name;
  const source = text(payload.source);
  return source && source !== "iris" ? `L'intégration ${source}` : "Le système";
}

/** « DEM-2026-000042 — Nid-de-poule rue des Lilas », ou ce qu'il en reste. */
export function requestLabel(payload: NotificationPayload): string {
  const parts = [text(payload.reference), text(payload.subject)].filter((p) => p !== "");
  return parts.length > 0 ? parts.join(" — ") : "une demande";
}

/** Objet du message : court, préfixé de la référence pour le tri en boîte. */
function subjectLine(head: string, payload: NotificationPayload): string {
  const ref = text(payload.reference);
  return ref ? `${ref} — ${head}` : head;
}

/**
 * « La demande X a été transférée de A vers B. » — la phrase que le lecteur
 * doit trouver EN PREMIER, à la voix passive et avec les deux organismes
 * nommés : ce qu'il veut savoir, c'est d'où le dossier arrive et chez qui il
 * atterrit, pas qui a cliqué (l'auteur suit, sur sa propre ligne).
 * Chaque bout manquant se retire de la phrase au lieu d'y laisser un trou.
 */
function transferLine(what: string, from: string, to: string): string {
  if (from && to) return `La demande ${what} a été transférée de ${from} vers ${to}.`;
  if (to) return `La demande ${what} a été transférée vers ${to}.`;
  if (from) return `La demande ${what} a été transférée de ${from} vers votre organisme.`;
  return `La demande ${what} a été transférée à votre organisme.`;
}

/** « Déposée le 12/03/2026. » — la date du DÉPÔT, pas celle du transfert :
 *  c'est elle qui dit depuis combien de temps l'usager attend. Une date
 *  illisible est omise plutôt que rendue en brut. */
function depositLine(payload: NotificationPayload): string | null {
  const raw = text(payload.received_at);
  if (raw === "") return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return `Déposée le ${date.toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris",
  })}.`;
}

/** « 12/03/2026 » depuis un jour `AAAA-MM-JJ`, sans passer par `Date` (aucun
 *  décalage de fuseau : le runtime est en UTC, le jour est celui de l'agent). */
function dayLabel(value: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Ligne de contexte ajoutée quand la démarche / le destinataire sont connus. */
function contextLine(payload: NotificationPayload): string | null {
  const parts = [text(payload.procedure), text(payload.destinataire)].filter((p) => p !== "");
  return parts.length > 0 ? `Démarche : ${parts.join(" — ")}.` : null;
}

export function brandFor(tenantName?: string | null): EmailBrand {
  return { productName: PRODUCT_NAME, tenantName: tenantName ?? null };
}

interface Body {
  subject: string;
  heading: string;
  paragraphs: string[];
}

function bodyFor(kind: string, payload: NotificationPayload): Body {
  const who = actor(payload);
  const what = requestLabel(payload);

  switch (kind) {
    case "assigned":
      return {
        subject: subjectLine("Une demande vous a été affectée", payload),
        heading: "Une demande vous a été affectée",
        paragraphs: [
          `${who} vous a affecté la demande ${what}.`,
          `Elle est actuellement au statut « ${statusLabel(payload.status)} ».`,
        ],
      };

    case "unassigned":
      return {
        subject: subjectLine("Une demande vous a été retirée", payload),
        heading: "Une demande vous a été retirée",
        paragraphs: [
          payload.reassigned
            ? `${who} a confié la demande ${what} à quelqu'un d'autre. Vous n'en êtes plus responsable.`
            : `${who} vous a retiré la demande ${what}. Elle n'a plus d'agent affecté.`,
          "Vous gardez accès à la fiche si votre périmètre vous y autorise.",
        ],
      };

    case "status_changed":
      return {
        subject: subjectLine(`Statut : ${statusLabel(payload.to)}`, payload),
        heading: "Le statut d'une de vos demandes a changé",
        paragraphs: [
          `${who} a fait passer la demande ${what} de « ${statusLabel(payload.from)} » à « ${statusLabel(payload.to)} ».`,
          ...(text(payload.motif) ? [`Motif enregistré : ${text(payload.motif)}.`] : []),
        ],
      };

    case "note_added":
      return {
        subject: subjectLine("Nouvelle note interne", payload),
        heading: "Une note interne a été ajoutée",
        paragraphs: [
          `${who} a ajouté une note interne sur la demande ${what}.`,
          // Le corps de la note ne quitte JAMAIS Iris — c'est le permalien qui
          // y donne accès, sous le contrôle du RLS.
          "Le contenu de la note n'est consultable que dans Iris, sur la fiche de la demande.",
        ],
      };

    case "mentioned":
      return {
        subject: subjectLine("Vous êtes mentionné dans une note", payload),
        heading: "Vous êtes mentionné dans une note interne",
        paragraphs: [
          `${who} vous a mentionné dans une note interne sur la demande ${what}.`,
          // Le corps de la note ne quitte JAMAIS Iris — surtout pas par e-mail.
          "Le contenu de la note n'est consultable que dans Iris, sur la fiche de la demande.",
        ],
      };

    case "new_request_in_scope": {
      const ctx = contextLine(payload);
      return {
        subject: subjectLine("Nouvelle demande dans votre périmètre", payload),
        heading: "Nouvelle demande dans votre périmètre",
        paragraphs: [
          `La demande ${what} vient d'entrer dans un périmètre que vous instruisez.`,
          ...(ctx ? [ctx] : []),
          `Statut à l'arrivée : « ${statusLabel(payload.status)} ». Elle n'a pas encore d'agent affecté.`,
        ],
      };
    }

    // ⚠️ Le DEMANDEUR n'y figure pas, malgré la tentation : un e-mail se
    // transfère, s'archive chez un fournisseur de messagerie, atterrit sur un
    // téléphone. La règle « jamais l'identité de l'usager » vaut ici comme
    // ailleurs — la fiche, sous RLS, porte le reste (arbitrage PO 2026-09-01).
    case "transferred_in": {
      const from = text(payload.from_destinataire);
      const to = text(payload.destinataire);
      const deposit = depositLine(payload);
      return {
        // L'objet nomme l'organisme QUITTÉ quand on le connaît : en liste de
        // réception, « qui me l'envoie » est ce qui permet de trier sans ouvrir.
        subject: subjectLine(
          from ? `Demande transférée par ${from}` : "Une demande vous a été transférée",
          payload,
        ),
        heading: "Une demande vous a été transférée",
        paragraphs: [
          transferLine(what, from, to),
          `Transfert effectué par ${who}.`,
          ...(text(payload.procedure) ? [`Démarche : ${text(payload.procedure)}.`] : []),
          ...(deposit ? [deposit] : []),
          `Statut à l'arrivée : « ${statusLabel(payload.status)} ».`,
        ],
      };
    }

    // L'e-mail à l'INTERVENANT (demande PO 2026-09-14) : ce qu'on attend de
    // lui, pour quand, sur quelle demande. Le commentaire de l'agent en est le
    // cœur ; le demandeur, l'adresse et les pièces restent sur la fiche.
    case "intervention_requested": {
      const day = dayLabel(payload.requested_for);
      const ctx = contextLine(payload);
      const comment = text(payload.comment);
      return {
        subject: subjectLine(
          day ? `Intervention attendue pour le ${day}` : "Intervention attendue",
          payload,
        ),
        heading: "Une intervention est attendue de votre part",
        paragraphs: [
          day
            ? `${who} vous sollicite pour une intervention sur la demande ${what}, souhaitée le ${day}.`
            : `${who} vous sollicite pour une intervention sur la demande ${what}.`,
          ...(ctx ? [ctx] : []),
          ...(comment ? [`Ce qui est attendu : ${comment}`] : []),
          "Une fois l'intervention faite, déclarez-la réalisée dans Iris (« Mes interventions » ou la fiche de la demande).",
        ],
      };
    }

    case "intervention_completed": {
      const day = dayLabel(payload.completed_on);
      const name = text(payload.intervenant_name) || who;
      const comment = text(payload.comment);
      return {
        subject: subjectLine("Intervention réalisée", payload),
        heading: "Une intervention a été réalisée",
        paragraphs: [
          day
            ? `${name} a déclaré réalisée, le ${day}, l'intervention demandée sur la demande ${what}.`
            : `${name} a déclaré réalisée l'intervention demandée sur la demande ${what}.`,
          ...(comment ? [`Commentaire de l'intervenant : ${comment}`] : []),
          // Les justificatifs restent sur la fiche, sous RLS : on dit qu'ils
          // existent, on ne les transporte pas.
          ...(typeof payload.attachments === "number" && payload.attachments > 0
            ? [payload.attachments === 1
                ? "Un justificatif a été joint à la fiche de la demande."
                : `${payload.attachments} justificatifs ont été joints à la fiche de la demande.`]
            : []),
          `La demande est au statut « ${statusLabel(payload.status)} » : l'instruction peut reprendre.`,
        ],
      };
    }

    default:
      return {
        subject: subjectLine("Mise à jour d'une demande", payload),
        heading: "Une demande a évolué",
        paragraphs: [`La demande ${what} a fait l'objet d'une mise à jour.`],
      };
  }
}

/**
 * Message complet, prêt pour `renderEmailHtml` / `renderEmailText`.
 * Le CTA porte le PERMALIEN : c'est la seule façon d'aller au détail, et il
 * reste gardé par l'authentification puis par le RLS.
 */
export function notificationEmail(input: NotificationEmailInput): EmailContent {
  const body = bodyFor(input.kind, input.payload);
  const brand = brandFor(input.tenantName);
  return {
    subject: `${body.subject} — ${brandLine(brand)}`,
    heading: body.heading,
    paragraphs: [greeting(input.recipientName), ...body.paragraphs],
    cta: { label: "Ouvrir la demande", url: input.requestUrl },
    footnote:
      "Vous recevez ce message parce que cette demande vous concerne dans Iris. " +
      "Vos préférences de notification se règlent dans l'application.",
  };
}

/** Permalien vers la fiche. `baseUrl` vient de `IRIS_APP_URL`. */
export function requestPermalink(baseUrl: string, requestId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/demandes/${requestId}`;
}
