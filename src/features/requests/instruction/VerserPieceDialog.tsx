// Verser au dossier une pièce reçue en réponse de l'usager (B10, décision PO
// 2026-10-24). Même règle que l'ajout d'une pièce : « la plus récente fait
// foi », et le remplacement est ANNONCÉ avant d'agir. Rien n'est présélectionné
// quand plusieurs exigences sont possibles — un défaut se valide sans être lu.

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { RequestAttachment } from "../useRequests";
import type { FilingTarget } from "./versement";

interface Props {
  /** La pièce de la réponse ; `null` ferme le dialogue. */
  piece: RequestAttachment | null;
  targets: FilingTarget[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (key: string | null) => void;
}

/** Valeur de bouton radio : la clé, ou un jeton pour « hors formulaire ». */
const OUTSIDE = "__hors_formulaire__";

export function VerserPieceDialog({ piece, targets, pending, error, onClose, onSubmit }: Props) {
  const [choice, setChoice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (piece) setChoice(targets.length === 1 ? OUTSIDE : null);
  }, [piece, targets.length]);

  const target = choice === null ? null : targets.find((t) => (t.key ?? OUTSIDE) === choice) ?? null;
  const replaced = target?.replaces.length ?? 0;

  return (
    <Dialog open={piece !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        {piece ? (
          <>
            <DialogHeader>
              <DialogTitle>Verser au dossier</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => { e.preventDefault(); if (target) onSubmit(target.key); }}
            >
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{piece.file_name}</span>, reçue en
                réponse de l'usager, deviendra une pièce de la demande, à qualifier. Elle reste aussi
                dans son message.
              </p>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="pb-1.5 text-[13px] font-bold">À quelle pièce répond-elle ?</legend>
                {targets.map((t) => {
                  const value = t.key ?? OUTSIDE;
                  return (
                    <label
                      key={value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[13px] transition-colors",
                        choice === value ? "border-primary/50 bg-primary/[0.04]" : "border-border hover:bg-secondary/20",
                      )}
                    >
                      <input
                        type="radio"
                        name="verser-cible"
                        value={value}
                        checked={choice === value}
                        onChange={() => setChoice(value)}
                      />
                      <span className="min-w-0 flex-1 font-semibold">{t.label}</span>
                      {t.required ? <span className="text-[11.5px] text-muted-foreground">obligatoire</span> : null}
                      {t.replaces.length > 0 ? (
                        <span className="text-[11.5px] text-muted-foreground">
                          {t.replaces.length === 1 ? "1 pièce déposée" : `${t.replaces.length} pièces déposées`}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </fieldset>

              {target && replaced > 0 ? (
                <p className="rounded-[14px] border border-secondary/60 bg-secondary/25 px-3.5 py-2.5 text-[12.5px] text-secondary-foreground">
                  Cette pièce <strong>remplacera</strong>{" "}
                  {replaced === 1 ? "la pièce déjà déposée" : `les ${replaced} pièces déjà déposées`}{" "}
                  pour cette exigence : {target.replaces.map((a) => a.file_name).join(", ")}.
                  {" "}Elles resteront au dossier, marquées « Remplacée », et sortiront du calcul
                  de conformité.
                </p>
              ) : null}

              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
                <Button type="submit" disabled={pending || !target}>
                  {pending ? "Versement…" : "Verser au dossier"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
