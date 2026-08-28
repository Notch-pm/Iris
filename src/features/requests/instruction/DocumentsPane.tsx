// Onglet « Documents » : les pièces de la demande, GROUPÉES PAR EXIGENCE du
// formulaire, avec leur qualification — puis les pièces d'instruction et les
// courriers, à venir (grisés).
//
// POURQUOI PAR EXIGENCE : une pièce se juge par rapport à ce qui était demandé.
// « Le justificatif de domicile est-il en règle ? » a un sens ; « ce PDF-là
// est-il en règle ? » beaucoup moins, surtout quand un champ accepte plusieurs
// fichiers. C'est aussi la seule façon de montrer une exigence OBLIGATOIRE que
// l'usager n'a jamais honorée : elle n'a aucune ligne à afficher, et c'est
// justement ce qu'il faut voir.
//
// Le verdict, lui, s'écrit fichier par fichier (`request_attachments`), par la
// RPC `qualify_request_attachment` — seule porte.

import { AlertTriangle, CheckCircle2, Plus, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RequestAttachment } from "../useRequests";
import { Pill, SOON, Surface, SurfaceHead } from "@/components/ui/surface";
import { attachmentExt, COPY_STATUS, formatBytes, formatDayMonth } from "./instruction";
import {
  blockingMessage, complianceCounts, motifLabel,
  type PieceRequirement, type QualifiableAttachment, type RequirementState,
} from "./conformite";

const STATE_PILL: Record<RequirementState, { label: string; tone: "ok" | "error" | "pending" | "neutral" }> = {
  conforme: { label: "Conforme", tone: "ok" },
  non_conforme: { label: "Non conforme", tone: "error" },
  a_qualifier: { label: "À qualifier", tone: "neutral" },
  manquante: { label: "Manquante", tone: "pending" },
};

interface Props {
  attachments: RequestAttachment[];
  requirements: PieceRequirement[];
  canInstruct: boolean;
  archived: boolean;
  /** La demande attend-elle une information de l'usager ? */
  waiting: boolean;
  /** Tout est redevenu conforme : on propose la reprise. */
  readyToResume: boolean;
  resuming: boolean;
  onQualify: (attachment: QualifiableAttachment, requirementLabel: string | null) => void;
  /** Déposer une pièce sur une exigence non conforme ou manquante. */
  onAddPiece: (requirement: PieceRequirement) => void;
  onSignal: () => void;
  onResume: () => void;
  onOpen: (attachment: RequestAttachment) => void;
  onDownload: (attachment: RequestAttachment) => void;
}

export function DocumentsPane({
  attachments, requirements, canInstruct, archived, waiting, readyToResume,
  resuming, onQualify, onAddPiece, onSignal, onResume, onOpen, onDownload,
}: Props) {
  const byId = new Map(attachments.map((a) => [a.id, a]));
  const counts = complianceCounts(requirements);
  const blocking = blockingMessage(requirements);
  const nonConformes = requirements.filter((r) => r.state === "non_conforme");
  const n = requirements.reduce((sum, r) => sum + r.attachments.length, 0);

  const qualifyTitle = !canInstruct
    ? "Exige le droit d'instruction sur cette demande"
    : archived ? "Demande archivée" : undefined;

  return (
    <div className="flex flex-col gap-3.5">
      <Surface>
        <SurfaceHead
          title="Pièces de la demande"
          sub={
            requirements.length === 0
              ? "Aucune pièce déposée"
              : [
                  `${n} pièce${n > 1 ? "s" : ""}`,
                  counts.conforme > 0 ? `${counts.conforme} conforme${counts.conforme > 1 ? "s" : ""}` : null,
                  counts.nonConforme > 0 ? `${counts.nonConforme} non conforme${counts.nonConforme > 1 ? "s" : ""}` : null,
                  counts.aQualifier > 0 ? `${counts.aQualifier} à qualifier` : null,
                  counts.manquante > 0 ? `${counts.manquante} manquante${counts.manquante > 1 ? "s" : ""}` : null,
                ].filter(Boolean).join(" · ")
          }
          action={<Button type="button" variant="outline" size="sm" {...SOON}><Plus /> Demander une pièce</Button>}
        />

        {blocking ? (
          <p className="flex items-start gap-2 rounded-[14px] border border-secondary/60 bg-secondary/25 px-3.5 py-2.5 text-[12.5px] text-secondary-foreground">
            <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span>{blocking}</span>
          </p>
        ) : null}

        {nonConformes.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-destructive/25 bg-destructive/5 px-3.5 py-2.5">
            <span className="text-[12.5px] text-destructive">
              {nonConformes.length === 1
                ? "Une pièce est non conforme. L'usager doit en être averti pour la transmettre à nouveau."
                : `${nonConformes.length} pièces sont non conformes. L'usager doit en être averti pour les transmettre à nouveau.`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canInstruct || archived}
              title={qualifyTitle}
              onClick={onSignal}
            >
              <Send /> Signaler à l'usager
            </Button>
          </div>
        ) : null}

        {waiting && readyToResume ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-primary/25 bg-primary/5 px-3.5 py-2.5">
            <span className="flex items-start gap-2 text-[12.5px] text-primary">
              <CheckCircle2 className="mt-px size-4 shrink-0" aria-hidden="true" />
              <span>Toutes les pièces attendues sont conformes. L'instruction peut reprendre.</span>
            </span>
            <Button
              type="button"
              size="sm"
              disabled={!canInstruct || archived || resuming}
              title={qualifyTitle}
              onClick={onResume}
            >
              {resuming ? "Reprise…" : "Reprendre l'instruction"}
            </Button>
          </div>
        ) : null}

        {requirements.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {requirements.map((req) => {
              const pill = STATE_PILL[req.state];
              return (
                <div
                  key={req.key ?? req.attachments[0]?.id ?? req.label}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border px-[13px] py-[11px]",
                    req.state === "non_conforme"
                      ? "border-destructive/30 bg-destructive/[0.03]"
                      : "border-border bg-background",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-[13px] font-bold">{req.label}</span>
                    {req.required ? <Pill tone="neutral">Obligatoire</Pill> : null}
                    <Pill tone={pill.tone}>{pill.label}</Pill>
                    {/* Le dépôt n'est proposé QUE là où il répond à un manque —
                        une exigence conforme n'appelle pas de pièce de plus. */}
                    {req.state === "non_conforme" || req.state === "manquante" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        disabled={!canInstruct || archived}
                        title={qualifyTitle}
                        onClick={() => onAddPiece(req)}
                      >
                        <Upload /> {req.state === "manquante" ? "Déposer la pièce" : "Remplacer la pièce"}
                      </Button>
                    ) : null}
                  </div>

                  {req.state === "manquante" ? (
                    <p className="text-[11.5px] text-muted-foreground">
                      Aucune pièce déposée pour cette exigence.
                    </p>
                  ) : null}

                  {req.attachments.map((piece) => {
                    const row = byId.get(piece.id);
                    const ext = attachmentExt(piece.file_name, row?.mime_type ?? null);
                    const copy = row ? (COPY_STATUS[row.copy_status] ?? { label: row.copy_status, tone: "neutral" as const }) : null;
                    const meta = [
                      row ? formatBytes(row.file_size) : null,
                      row ? `déposée le ${formatDayMonth(row.created_at)}` : null,
                      piece.compliance === "non_conforme" ? motifLabel(piece.compliance_motif) : null,
                    ].filter(Boolean).join(" · ");
                    const available = row?.copy_status === "copied";
                    return (
                      <div key={piece.id} className="flex flex-wrap items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-[10px] font-extrabold",
                            ext === "PDF" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground/80",
                          )}
                        >
                          {ext}
                        </span>
                        <span className="flex min-w-[150px] flex-1 flex-col gap-0.5">
                          <span className="break-all text-[13px] font-semibold">{piece.file_name}</span>
                          {meta ? <span className="text-[11.5px] text-muted-foreground">{meta}</span> : null}
                          {piece.compliance_note ? (
                            <span className="text-[11.5px] italic text-muted-foreground">
                              « {piece.compliance_note} »
                            </span>
                          ) : null}
                        </span>
                        {/* L'état de copie ne se montre que s'il fait obstacle : « Disponible »
                            sur chaque ligne serait une troisième pastille pour rien. */}
                        {row && copy && row.copy_status !== "copied" ? <Pill tone={copy.tone}>{copy.label}</Pill> : null}
                        <span className="flex gap-1.5">
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs"
                            disabled={!available || !row} onClick={() => row && onOpen(row)}>
                            Voir
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2.5 text-xs"
                            disabled={!available || !row} onClick={() => row && onDownload(row)}>
                            Télécharger
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            disabled={!canInstruct || archived}
                            title={qualifyTitle}
                            onClick={() => onQualify(piece, req.key ? req.label : null)}
                          >
                            {piece.compliance ? "Requalifier" : "Qualifier"}
                          </Button>
                        </span>
                      </div>
                    );
                  })}

                  {req.superseded.length > 0 ? (
                    <details className="text-[11.5px] text-muted-foreground">
                      <summary className="cursor-pointer select-none font-semibold">
                        {req.superseded.length === 1
                          ? "1 pièce remplacée"
                          : `${req.superseded.length} pièces remplacées`}
                      </summary>
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {req.superseded.map((old) => {
                          const row = byId.get(old.id);
                          const why = old.compliance === "non_conforme"
                            ? motifLabel(old.compliance_motif) : null;
                          return (
                            <li key={old.id} className="flex flex-wrap items-center gap-2">
                              <Pill tone="neutral">Remplacée</Pill>
                              <span className="break-all line-through">{old.file_name}</span>
                              {why ? <span>· {why}</span> : null}
                              <Button type="button" variant="ghost" size="sm"
                                className="h-6 px-2 text-[11px]"
                                disabled={!row || row.copy_status !== "copied"}
                                onClick={() => row && onDownload(row)}>
                                Télécharger
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </Surface>

      <Surface className="opacity-60" aria-disabled="true">
        <SurfaceHead
          title="Pièces d'instruction"
          sub="Internes au service — non transmises à l'usager"
          action={<Button type="button" variant="outline" size="sm" {...SOON}><Plus /> Ajouter une pièce</Button>}
        />
        <p className="text-sm text-muted-foreground">
          Le dépôt de pièces internes à l'instruction arrive dans une prochaine version.
        </p>
      </Surface>

      <Surface className="opacity-60" aria-disabled="true">
        <SurfaceHead
          title="Courriers"
          sub="Générés depuis les modèles du service"
          action={<Button type="button" variant="outline" size="sm" {...SOON}><Plus /> Générer un courrier</Button>}
        />
        <p className="text-sm text-muted-foreground">
          La génération de courriers depuis les modèles du service arrive dans une prochaine version.
        </p>
      </Surface>
    </div>
  );
}
