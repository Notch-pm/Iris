// Onglet « Interventions » de la fiche : les sollicitations de la demande, à
// réaliser d'abord, et le bouton « Solliciter un intervenant » — ouvert
// exactement quand la RPC l'accepterait (statut « en cours d'instruction »,
// droit d'instruction), fermé AVEC sa raison sinon. L'intervenant sollicité y
// trouve aussi son bouton « Déclarer réalisée », et chaque intervention
// réalisée montre ses JUSTIFICATIFS (photos, documents) déposés au moment de
// la déclaration.

import { CalendarClock, HardHat, Paperclip, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill, Surface, SurfaceHead } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import type { RequestAttachment } from "../useRequests";
import { inlineViewable } from "../instruction/documents";
import { attachmentExt, formatBytes, formatTimeline } from "../instruction/instruction";
import {
  canComplete, formatDay, interventionStatusLabel, interventionTone, isLate, isoDay,
  sortInterventions, type InterventionRow,
} from "./interventions";

interface Props {
  interventions: InterventionRow[];
  /** Justificatifs d'intervention du dossier (`kind = intervention`), toutes interventions confondues. */
  attachments: RequestAttachment[];
  nameOf: (userId: string | null) => string;
  currentUserId: string | null;
  /** `solicitGate` de la fiche : ouvert, ou fermé avec sa raison. */
  canSolicit: boolean;
  solicitReason: string | null;
  pending: boolean;
  onSolicit: () => void;
  onComplete: (intervention: InterventionRow) => void;
  onOpen: (attachment: RequestAttachment) => void;
  onDownload: (attachment: RequestAttachment) => void;
}

export function InterventionsPane({
  interventions, attachments, nameOf, currentUserId, canSolicit, solicitReason, pending,
  onSolicit, onComplete, onOpen, onDownload,
}: Props) {
  const today = isoDay(new Date());
  const rows = sortInterventions(interventions);

  return (
    <Surface>
      <SurfaceHead
        title="Interventions"
        sub="Intervenants sollicités pendant l'instruction"
        action={
          <Button
            type="button"
            size="sm"
            disabled={!canSolicit || pending}
            title={solicitReason ?? undefined}
            onClick={onSolicit}
          >
            <Plus /> Solliciter un intervenant
          </Button>
        }
      />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun intervenant n'a été sollicité sur cette demande.
          {solicitReason ? ` ${solicitReason}.` : ""}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((i) => {
            const tone = interventionTone(i, today);
            const late = isLate(i, today);
            const proofs = attachments.filter((a) => a.intervention_id === i.id && a.email_id === null);
            return (
              <li
                key={i.id}
                className={cn(
                  "flex flex-col gap-2 rounded-[14px] border border-border px-3.5 py-3",
                  tone === "ok" ? "bg-muted/30" : "bg-card",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <HardHat className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate text-[13.5px] font-bold">{nameOf(i.intervenant_id)}</span>
                    <Pill tone={tone}>{late ? "En retard" : interventionStatusLabel(i.status)}</Pill>
                  </div>
                  {canComplete(i, currentUserId) ? (
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onComplete(i)}>
                      Déclarer réalisée
                    </Button>
                  ) : null}
                </div>

                <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <CalendarClock className="size-3.5" aria-hidden="true" />
                  Intervention demandée pour le <span className="font-semibold text-foreground">{formatDay(i.requested_for)}</span>
                  {" "}· sollicitée par {nameOf(i.requested_by)} le {formatTimeline(i.requested_at)}
                </p>
                {i.request_comment ? (
                  <p className="whitespace-pre-wrap text-[13px]">{i.request_comment}</p>
                ) : null}

                {i.status === "realisee" ? (
                  <div className="flex flex-col gap-2 rounded-[10px] bg-primary/[0.06] px-3 py-2 text-[12.5px]">
                    <p className="font-semibold text-primary">
                      Réalisée le {formatDay(i.completed_on)}
                      {i.completed_at ? ` · déclarée le ${formatTimeline(i.completed_at)}` : ""}
                    </p>
                    {i.completion_comment ? (
                      <p className="whitespace-pre-wrap text-foreground">{i.completion_comment}</p>
                    ) : null}
                    {proofs.length > 0 ? (
                      <ul className="flex flex-col gap-1.5" aria-label="Justificatifs">
                        {proofs.map((doc) => {
                          const ext = attachmentExt(doc.file_name, doc.mime_type);
                          return (
                            <li key={doc.id} className="flex flex-wrap items-center gap-2.5 rounded-[9px] bg-card px-2.5 py-1.5">
                              <span
                                aria-hidden="true"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-muted text-[9.5px] font-extrabold text-foreground/80"
                              >
                                {ext}
                              </span>
                              <span className="flex min-w-[120px] flex-1 flex-col">
                                <span className="break-all text-[12.5px] font-semibold">{doc.file_name}</span>
                                <span className="text-[11px] text-muted-foreground">{formatBytes(doc.file_size)}</span>
                              </span>
                              <span className="flex gap-1">
                                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                                  disabled={!inlineViewable(doc.mime_type)}
                                  title={!inlineViewable(doc.mime_type) ? "Ce format ne s'affiche pas dans le navigateur : téléchargez-le." : undefined}
                                  onClick={() => onOpen(doc)}>
                                  Voir
                                </Button>
                                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                                  onClick={() => onDownload(doc)}>
                                  Télécharger
                                </Button>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="flex items-center gap-1.5 text-muted-foreground">
                        <Paperclip className="size-3.5" aria-hidden="true" /> Aucun justificatif joint.
                      </p>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}
