// L'intervenant déclare son intervention réalisée : date de finalisation
// (proposée au jour courant, modifiable — une intervention se déclare souvent
// après coup), commentaire facultatif, et JUSTIFICATIFS : documents joints ou
// photos prises à l'instant avec la caméra de l'appareil, quatre au plus
// (décision PO 2026-09-14). La RPC `complete_request_intervention` reste
// l'autorité : réservée à l'intervenant sollicité, date non future, quatre
// pièces au plus — et chaque fichier passe par la porte unique avant elle.

import * as React from "react";
import { Camera, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ACCEPTED_FORMATS_LABEL, acceptAttribute } from "@fn/_shared/files/magic";
import { formatBytes } from "../instruction/instruction";
import {
  addFiles, defaultCompletion, filesCountLabel, formatDay, isoDay, MAX_INTERVENTION_FILES,
  validateCompletion, type CompletionDraft, type InterventionRow,
} from "./interventions";
import { CameraCaptureDialog, prefersNativeCapture, supportsInAppCamera } from "./CameraCapture";

interface Props {
  /** L'intervention visée ; `null` ferme le dialogue. */
  intervention: InterventionRow | null;
  /** Référence et objet de la demande, pour que l'intervenant reconnaisse ce qu'il déclare. */
  requestLabel: string | null;
  pending: boolean;
  /** Ce que le serveur est en train de faire (« Envoi de photo-….jpg… »). */
  progress?: string | null;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: CompletionDraft) => void;
}

export function ConfirmerInterventionDialog({
  intervention, requestLabel, pending, progress, error, onClose, onSubmit,
}: Props) {
  const today = isoDay(new Date());
  const [draft, setDraft] = React.useState<CompletionDraft>(() => defaultCompletion(today));
  const [submitted, setSubmitted] = React.useState(false);
  const [refusedNote, setRefusedNote] = React.useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const captureInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (intervention) {
      setDraft(defaultCompletion(isoDay(new Date())));
      setSubmitted(false);
      setRefusedNote(null);
      setCameraOpen(false);
    }
  }, [intervention]);

  const errors = submitted ? validateCompletion(draft, today) : [];
  const remaining = MAX_INTERVENTION_FILES - draft.files.length;
  const full = remaining <= 0;
  // La caméra native sur un écran tactile, l'aperçu dans la page ailleurs ;
  // sans caméra du tout, le bouton n'existe pas — le fichier reste possible.
  const nativeCapture = prefersNativeCapture();
  const canTakePhoto = nativeCapture || supportsInAppCamera();

  function pushFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    const result = addFiles(draft.files, incoming);
    setDraft((d) => ({ ...d, files: result.files }));
    setRefusedNote(result.refused > 0
      ? `${result.refused} fichier${result.refused > 1 ? "s" : ""} non retenu${result.refused > 1 ? "s" : ""} : ${MAX_INTERVENTION_FILES} justificatifs au plus.`
      : null);
  }

  function removeFile(index: number) {
    setDraft((d) => ({ ...d, files: d.files.filter((_, i) => i !== index) }));
    setRefusedNote(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (validateCompletion(draft, today).length > 0) return;
    onSubmit({ ...draft, comment: draft.comment.trim() });
  }

  return (
    <Dialog open={intervention !== null} onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent>
        {intervention ? (
          <>
            <DialogHeader>
              <DialogTitle>Déclarer l'intervention réalisée</DialogTitle>
            </DialogHeader>
            <form className="flex max-h-[76vh] flex-col gap-4 overflow-y-auto pr-1" onSubmit={submit}>
              <div className="rounded-[14px] bg-muted/40 px-3.5 py-2.5 text-[12.5px]">
                {requestLabel ? <p className="font-semibold">{requestLabel}</p> : null}
                <p className="text-muted-foreground">
                  Intervention demandée pour le {formatDay(intervention.requested_for)}
                  {intervention.request_comment ? (
                    <>
                      {" "}:{" "}
                      <span className="text-foreground">{intervention.request_comment}</span>
                    </>
                  ) : null}
                </p>
              </div>

              <Field label="Date de finalisation" htmlFor="conf-date" required error={errors.find((e) => e.includes("date"))}>
                <Input
                  id="conf-date"
                  type="date"
                  max={today}
                  value={draft.completedOn}
                  onChange={(e) => setDraft((d) => ({ ...d, completedOn: e.target.value }))}
                />
              </Field>

              <Field label="Commentaire" htmlFor="conf-comment" hint="Facultatif — ce qui a été fait, ce qui reste à faire.">
                <Textarea
                  id="conf-comment"
                  rows={3}
                  value={draft.comment}
                  onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
                />
              </Field>

              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">Justificatifs</span>
                  <span className="text-[11.5px] text-muted-foreground">{filesCountLabel(draft.files.length)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Photos de l'intervention, bon de travaux, rapport… {ACCEPTED_FORMATS_LABEL}
                </p>

                {draft.files.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {draft.files.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="flex items-center gap-2.5 rounded-[10px] border border-border bg-card px-3 py-2">
                        <Paperclip className="size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{file.name}</span>
                        <span className="text-[11.5px] text-muted-foreground">{formatBytes(file.size)}</span>
                        <button
                          type="button"
                          aria-label={`Retirer ${file.name}`}
                          disabled={pending}
                          onClick={() => removeFile(index)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          <X className="size-4" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending || full}
                    title={full ? `${MAX_INTERVENTION_FILES} justificatifs au plus` : undefined}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip /> Joindre un document
                  </Button>
                  {canTakePhoto ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={pending || full}
                      title={full ? `${MAX_INTERVENTION_FILES} justificatifs au plus` : undefined}
                      onClick={() => (nativeCapture ? captureInputRef.current?.click() : setCameraOpen(true))}
                    >
                      <Camera /> Prendre une photo
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={acceptAttribute() || undefined}
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => { pushFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
                />
                {/* `capture` ouvre l'appareil photo natif sur mobile ; ailleurs, le navigateur
                    retombe sur un sélecteur de fichiers — jamais une impasse. */}
                <input
                  ref={captureInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => { pushFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
                />
                {refusedNote ? <p role="status" className="text-xs text-secondary-foreground">{refusedNote}</p> : null}
                {errors.find((e) => e.includes("justificatifs")) ? (
                  <p role="alert" className="text-sm text-destructive">{errors.find((e) => e.includes("justificatifs"))}</p>
                ) : null}
              </div>

              {progress && pending ? <p role="status" className="text-xs text-muted-foreground">{progress}</p> : null}
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

              <DialogFooter>
                <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>Annuler</Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Enregistrement…" : "Confirmer la réalisation"}
                </Button>
              </DialogFooter>
            </form>

            <CameraCaptureDialog
              open={cameraOpen}
              remaining={remaining}
              onClose={() => setCameraOpen(false)}
              onCapture={(file) => pushFiles([file])}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
