import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { reachableSteps, type CreationStep } from "./model";

export interface StepDef {
  num: CreationStep;
  label: string;
  hint: string;
}

interface Props {
  steps: StepDef[];
  current: number;
  /** Étape la plus avancée atteinte : les étapes au-delà ne sont pas cliquables… */
  maxReached: number;
  /**
   * …à une près : quand l'étape courante est franchissable — c'est-à-dire quand
   * le bouton « Continuer » est actif —, la puce SUIVANTE l'est aussi
   * (demande du 2026-08-31). L'appelant doit alors traiter ce clic comme le
   * bouton lui-même : `onGo` reçoit une étape au-delà de `maxReached`, et
   * c'est à lui de la valider avant d'y aller.
   */
  canAdvance?: boolean;
  onGo: (step: CreationStep) => void;
}

export function CreationStepper({ steps, current, maxReached, canAdvance = false, onGo }: Props) {
  const nums = steps.map((s) => s.num);
  const reachable = reachableSteps(nums, current, maxReached, canAdvance);
  return (
    <ol className="flex items-center gap-1.5" aria-label="Étapes de la saisie">
      {steps.map((s, i) => {
        const isCurrent = current === s.num;
        const isPast = current > s.num;
        const isReachable = reachable.has(s.num);
        // La puce franchissable se donne l'air d'une étape faite : elle est
        // cliquable, et un gris de « verrouillé » mentirait. Sa pastille garde
        // son numéro (pas de coche) — c'est ce qui la distingue d'une étape
        // réellement parcourue.
        const isNext = isReachable && !isCurrent && !isPast;
        return (
          <li key={s.num} className={cn("flex items-center gap-1.5", i < steps.length - 1 && "flex-1")}>
            <button
              type="button"
              disabled={!isReachable}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onGo(s.num)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[13px] font-semibold transition-colors",
                "disabled:cursor-default",
                isCurrent
                  ? "border-primary bg-primary/[0.06] text-primary"
                  : isPast || isNext
                    ? "border-primary/30 bg-card text-foreground hover:bg-secondary/40"
                    : "border-border bg-card text-muted-foreground",
                isReachable && !isCurrent && "cursor-pointer",
              )}
            >
              <span
                className={cn(
                  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11.5px] font-extrabold",
                  isCurrent || isPast ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                {/* Le RANG affiché, pas l'identifiant d'étape : l'étape
                    « organisme » n'est proposée qu'à qui a plusieurs
                    organismes, et sans elle le parcours doit rester numéroté
                    1 à 4. */}
                {isPast ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className="flex min-w-0 max-w-[168px] flex-col items-start gap-0.5 leading-tight">
                <span className="whitespace-nowrap font-bold">{s.label}</span>
                <span className="block max-w-[168px] truncate text-[11px] font-medium opacity-70">{s.hint}</span>
              </span>
            </button>
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn("h-0.5 flex-1 rounded", current > s.num ? "bg-primary" : "bg-border")}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
