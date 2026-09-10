// Prise de photo pour un justificatif d'intervention.
//
// DEUX CHEMINS, selon l'appareil :
//   · sur un appareil à écran tactile (téléphone, tablette — `pointer: coarse`),
//     un `<input type="file" capture="environment">` : c'est l'appareil photo
//     NATIF qui s'ouvre, avec sa mise au point, son flash, son zoom — rien
//     qu'une page web ne saurait égaler ;
//   · sur un poste fixe équipé d'une webcam, un aperçu vidéo dans un dialogue
//     (`getUserMedia`) et un bouton de capture, l'image étant tirée sur un
//     canvas en JPEG.
// Dans les deux cas le résultat est un `File` ordinaire : il passe par la
// porte unique comme n'importe quel document, et c'est le SERVEUR qui vérifie
// que c'est bien une image (signature binaire).
//
// Le flux vidéo est arrêté dès que le dialogue se ferme : une caméra qui reste
// allumée après coup est le genre de chose qu'on ne pardonne pas.

import * as React from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { photoFileName } from "./interventions";

/** Peut-on afficher un aperçu vidéo dans la page ? */
export function supportsInAppCamera(): boolean {
  return typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && (typeof window === "undefined" || window.isSecureContext !== false);
}

/** Sur un écran tactile, l'appareil photo natif vaut mieux qu'un aperçu dans la page. */
export function prefersNativeCapture(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
}

interface Props {
  open: boolean;
  /** Nombre de photos encore possibles ; à zéro, le bouton de capture se ferme. */
  remaining: number;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export function CameraCaptureDialog({ open, remaining, onClose, onCapture }: Props) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [taken, setTaken] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setReady(false);
    setTaken(0);
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      setReady(true);
    }).catch((err: unknown) => {
      const name = err instanceof Error ? err.name : "";
      setError(name === "NotAllowedError"
        ? "L'accès à la caméra a été refusé. Autorisez-le dans le navigateur, ou joignez une photo depuis vos fichiers."
        : "Aucune caméra utilisable n'a été trouvée. Joignez une photo depuis vos fichiers.");
    });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const index = taken + 1;
    canvas.toBlob((blob) => {
      if (!blob) { setError("La photo n'a pas pu être enregistrée."); return; }
      onCapture(new File([blob], photoFileName(new Date(), index), { type: "image/jpeg" }));
      setTaken(index);
    }, "image/jpeg", 0.9);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Prendre une photo</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-[14px] border border-border bg-black">
            {/* Miroir désactivé : une photo de chantier se lit dans le bon sens. */}
            <video ref={videoRef} playsInline muted className="block max-h-[60vh] w-full object-contain" />
            {!ready && !error ? (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-primary-foreground/80">
                Ouverture de la caméra…
              </p>
            ) : null}
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <p className="text-[12.5px] text-muted-foreground" aria-live="polite">
            {taken > 0 ? `${taken} photo${taken > 1 ? "s" : ""} prise${taken > 1 ? "s" : ""} · ` : ""}
            {remaining > 0
              ? `encore ${remaining} possible${remaining > 1 ? "s" : ""}`
              : "plus aucune photo possible : le plafond est atteint"}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            <X /> {taken > 0 ? "Terminer" : "Annuler"}
          </Button>
          <Button type="button" disabled={!ready || remaining <= 0} onClick={capture}>
            <Camera /> Capturer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
