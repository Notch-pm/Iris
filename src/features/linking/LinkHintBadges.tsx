// Pastilles « demandes liées » d'une ligne de la liste des demandes (lot L5 de
// docs/demandes-liees.md) : « Liée à N » quand la demande est dans un groupe
// « même incident », « Même incident ? » quand une demande approchante probable
// existe dans le périmètre de l'agent. Rien ne s'affiche sinon.

import { Link2, Sparkle } from "lucide-react";
import type { LinkHint } from "./useLinking";

export function LinkHintBadges({ hint }: { hint: LinkHint | undefined }) {
  if (!hint) return null;
  const others = Math.max(0, hint.groupSize - 1);
  if (others === 0 && hint.likelySimilar === 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {others > 0 ? (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-bold text-primary"
          title="Liée à d'autres demandes du même incident"
        >
          <Link2 className="size-3" aria-hidden="true" />
          Liée à {others}
        </span>
      ) : null}
      {hint.likelySimilar > 0 ? (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-bold text-secondary-foreground"
          title={`${hint.likelySimilar} demande${hint.likelySimilar > 1 ? "s" : ""} signale${hint.likelySimilar > 1 ? "nt" : ""} probablement le même incident — ouvrez la fiche pour décider`}
        >
          <Sparkle className="size-3" aria-hidden="true" />
          Même incident ?
        </span>
      ) : null}
    </span>
  );
}
