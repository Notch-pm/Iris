// Feuille MOBILE « Déclarer l'intervention » (maquette « Iris mobile — v2 »,
// écran 8) : mêmes données et mêmes gardes que `ConfirmerInterventionDialog`
// (bureau — même brouillon, même validation, même porte à deux temps pour les
// pièces jointes), rendues en feuille plein écran avec des VIGNETTES plutôt
// qu'une liste : c'est le geste réel du terrain, une photo à la fois.
//
// ⚠️ PAS de choix « Impossible / Reportée » : le modèle actuel de
// `request_interventions` n'a qu'un résultat, « réalisée » — la maquette en
// esquissait deux autres, mais c'est une décision produit qui n'appartient
// pas à cet écran, pas quelque chose à inventer ici.
// ⚠️ PAS de mention « hors ligne » : Iris ne fonctionne pas hors ligne
// (aucun service worker, cf. `src/components/layout/CLAUDE.md`).

import * as React from "react";
import { Camera, File as FileIcon, Paperclip, X } from "lucide-react";
import { MobileSection, MobileSheet } from "@/components/layout/mobile/MobilePage";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ACCEPTED_FORMATS_LABEL, acceptAttribute } from "@fn/_shared/files/magic";
import { attachmentExt } from "../../instruction/instruction";
import {
  addFiles, defaultCompletion, filesCountLabel, isoDay, MAX_INTERVENTION_FILES,
  validateCompletion, type CompletionDraft, type InterventionRow,
} from "../interventions";
import { CameraCaptureDialog, prefersNativeCapture, supportsInAppCamera } from "../CameraCapture";
import { isImageFile, photoLabel } from "./mobileInterventions";

interface Props {
  /** L'intervention visée ; `null` ferme la feuille. */
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

interface ThumbProps {
  file: File;
  /** Rang parmi les PHOTOS seules (« Photo 1 », « Photo 2 »…), pas parmi tous les fichiers. */
  photoIndex: number | null;
  disabled: boolean;
  onRemove: () => void;
}

/** Vignette d'un justificatif : aperçu pour une image, extension pour un document. */
function Thumb({ file, photoIndex, disabled, onRemove }: ThumbProps) {
  const image = isImageFile(file);
  const [url, setUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!image) { setUrl(null); return; }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, image]);

  return (
    <div className="relative flex aspect-square flex-col overflow-hidden rounded-[14px] border border-border bg-muted/40 shadow-airbnb-sm">
      {image && url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1.5 text-center">
          <FileIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          <span className="text-[10.5px] font-bold text-muted-foreground">{attachmentExt(file.name, file.type)}</span>
        </div>
      )}
      <span className="absolute bottom-1 left-1 right-6 truncate rounded-md bg-black/60 px-1.5 py-0.5 text-[10.5px] font-bold text-white">
        {image && photoIndex !== null ? photoLabel(photoIndex) : file.name}
      </span>
      <button
        type="button"
        aria-label={`Retirer ${file.name}`}
        disabled={disabled}
        onClick={onRemove}
        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 disabled:opacity-50"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function DeclarerInterventionSheet({
  intervention, requestLabel, pending, progress, error, onClose, onSubmit,
}: Props) {
  const today = isoDay(new Date());
  const [draft, setDraft] = React.useState<CompletionDraft>(() => defaultCompletion(today));
  const [submitted, setSubmitted] = React.useState(false);
  const [refusedNote, setRefusedNote] = React.useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const captureInputRef = React.useRef<HTMLInputElement>(null);

  // Nouvelle sollicitation : le brouillon repart de zéro (jour courant proposé).
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
  // Caméra native sur un écran tactile, aperçu dans la page ailleurs ; sans
  // caméra du tout, la tuile n'existe pas — le document reste possible.
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

  function submit() {
    setSubmitted(true);
    if (validateCompletion(draft, today).length > 0) return;
    onSubmit({ ...draft, comment: draft.comment.trim() });
  }

  const filesError = errors.find((e) => e.includes("justificatifs"));
  const dateError = errors.find((e) => e.includes("date"));
  let photoRank = 0;

  return (
    <MobileSheet
      open={intervention !== null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Déclarer l'intervention"
      subtitle={requestLabel}
      locked={pending}
      footer={intervention ? (
        <>
          <Button
            type="button"
            size="lg"
            disabled={pending}
            onClick={submit}
            className="h-12 w-full rounded-[14px] text-base"
          >
            {pending ? "Envoi en cours…" : "Envoyer le compte rendu"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">L'agent instructeur est notifié.</p>
        </>
      ) : null}
    >
      {intervention ? (
        <>
          <MobileSection
            title="1 · Justificatifs"
            action={<span className="text-[11.5px] font-semibold text-muted-foreground">{filesCountLabel(draft.files.length)}</span>}
            hint={`Photos de l'intervention, bon de travaux, rapport… ${ACCEPTED_FORMATS_LABEL}`}
          >
            <div className="grid grid-cols-3 gap-2.5">
              {draft.files.map((file, index) => {
                const image = isImageFile(file);
                if (image) photoRank += 1;
                return (
                  <Thumb
                    key={`${file.name}-${index}`}
                    file={file}
                    photoIndex={image ? photoRank : null}
                    disabled={pending}
                    onRemove={() => removeFile(index)}
                  />
                );
              })}
              {!full && canTakePhoto ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => (nativeCapture ? captureInputRef.current?.click() : setCameraOpen(true))}
                  className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[14px] bg-primary text-primary-foreground shadow-airbnb-sm transition-colors hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
                >
                  <Camera className="size-6" aria-hidden="true" />
                  <span className="text-[12.5px] font-extrabold">Photo</span>
                </button>
              ) : null}
              {!full ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[14px] border border-border bg-card text-foreground shadow-airbnb-sm transition-colors hover:bg-muted/40 active:scale-[0.98] disabled:opacity-50"
                >
                  <Paperclip className="size-6 text-primary" aria-hidden="true" />
                  <span className="text-[12.5px] font-extrabold">Document</span>
                </button>
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
            {/* `capture` ouvre l'appareil photo natif sur mobile — jamais une impasse. */}
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
            {filesError ? <p role="alert" className="text-sm text-destructive">{filesError}</p> : null}
          </MobileSection>

          <MobileSection title="2 · Compte rendu">
            <Field label="Date de finalisation" htmlFor="mob-conf-date" required error={dateError}>
              <Input
                id="mob-conf-date"
                type="date"
                max={today}
                value={draft.completedOn}
                onChange={(e) => setDraft((d) => ({ ...d, completedOn: e.target.value }))}
              />
            </Field>
            <Field label="Commentaire" htmlFor="mob-conf-comment" hint="Facultatif — ce qui a été fait, ce qui reste à faire.">
              <Textarea
                id="mob-conf-comment"
                rows={4}
                value={draft.comment}
                onChange={(e) => setDraft((d) => ({ ...d, comment: e.target.value }))}
              />
            </Field>
          </MobileSection>

          {progress && pending ? <p role="status" className="text-xs text-muted-foreground">{progress}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

          <CameraCaptureDialog
            open={cameraOpen}
            remaining={remaining}
            onClose={() => setCameraOpen(false)}
            onCapture={(file) => pushFiles([file])}
          />
        </>
      ) : null}
    </MobileSheet>
  );
}
