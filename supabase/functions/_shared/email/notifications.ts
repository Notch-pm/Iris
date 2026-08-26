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
  | "new_request_in_scope";

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
