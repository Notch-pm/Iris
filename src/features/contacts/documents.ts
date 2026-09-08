// Documents d'un usager — logique pure (sans DOM ni réseau), testée.
//
// Une pièce appartient à une DEMANDE ; depuis le 2026-09-08 elle porte aussi
// l'usager de cette demande (`socle_contact_id`, écrit par trigger). La fiche
// usager peut donc répondre à « quels documents concernent cette personne ? »
// sans parcourir ses demandes une à une — le RLS continue de borner : on ne
// voit que les pièces des demandes qu'on peut lire.
//
// Ce qui est montré, et ce qui ne l'est pas :
//   · jamais une pièce d'instruction INTERNE — règle absolue, elle ne sort pas
//     du service, donc n'est pas « un document de l'usager » ;
//   · jamais une COPIE jointe à un échange (`source_attachment_id`) : l'original
//     est déjà listé, et le montrer deux fois ferait croire à deux documents ;
//   · les pièces JOINTES À UN ÉCHANGE déposées à la main (sans original) sont
//     montrées : elles ont réellement été transmises à cette personne ;
//   · les pièces REMPLACÉES restent listées, marquées — rien ne se supprime.

import type { RequestAttachment, RequestListItem } from "@/features/requests/useRequests";

export type UsagerDocumentNature =
  | "Pièce déposée"
  | "Jointe à un échange"
  | "Courrier"
  | "Pièce d'instruction transmissible";

export interface UsagerDocument {
  attachment: RequestAttachment;
  nature: UsagerDocumentNature;
  /** Remplacée par une pièce plus récente sur la même exigence. */
  superseded: boolean;
}

export interface UsagerDocumentGroup {
  requestId: string;
  reference: string;
  subject: string;
  status: string | null;
  documents: UsagerDocument[];
}

export function usagerDocumentNature(a: RequestAttachment): UsagerDocumentNature {
  if (a.email_id !== null) return "Jointe à un échange";
  if (a.kind === "courrier") return "Courrier";
  if (a.kind === "instruction_externe") return "Pièce d'instruction transmissible";
  return "Pièce déposée";
}

/** Une pièce que la fiche usager peut montrer. */
export function isUsagerDocument(a: RequestAttachment): boolean {
  return a.kind !== "instruction_interne" && a.source_attachment_id === null;
}

/**
 * Regroupe les pièces par demande, les demandes les plus récentes d'abord et,
 * dans chacune, les pièces les plus récentes d'abord. Une pièce dont la
 * demande n'est pas dans la liste (au-delà de la borne de la liste, par
 * exemple) reste montrée, sous sa seule référence d'identifiant.
 */
export function groupAttachmentsByRequest(
  attachments: readonly RequestAttachment[],
  requests: readonly RequestListItem[],
): UsagerDocumentGroup[] {
  const byRequest = new Map(requests.map((r) => [r.id, r]));
  const groups = new Map<string, UsagerDocumentGroup>();
  const sorted = [...attachments]
    .filter(isUsagerDocument)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const a of sorted) {
    let group = groups.get(a.request_id);
    if (!group) {
      const r = byRequest.get(a.request_id);
      group = {
        requestId: a.request_id,
        reference: r?.reference ?? `Demande ${a.request_id.slice(0, 8)}`,
        subject: r?.subject ?? "",
        status: r?.status ?? null,
        documents: [],
      };
      groups.set(a.request_id, group);
    }
    group.documents.push({
      attachment: a,
      nature: usagerDocumentNature(a),
      superseded: a.superseded_by !== null,
    });
  }
  const latest = (g: UsagerDocumentGroup) => g.documents[0]?.attachment.created_at ?? "";
  return [...groups.values()].sort((a, b) => latest(b).localeCompare(latest(a)));
}

export function usagerDocumentsSummary(groups: readonly UsagerDocumentGroup[]): string {
  const total = groups.reduce((n, g) => n + g.documents.length, 0);
  if (total === 0) return "Aucun document visible";
  const parts = [`${total} document${total > 1 ? "s" : ""} visible${total > 1 ? "s" : ""}`];
  if (groups.length > 1) parts.push(`${groups.length} demandes`);
  return parts.join(" · ");
}
