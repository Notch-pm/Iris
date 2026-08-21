import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreationStep } from "./model";

export interface StepDef {
  num: CreationStep;
  label: string;
  hint: string;
}

interface Props {
  steps: StepDef[];
  current: number;
  /** Étape la plus avancée atteinte : les étapes au-delà ne sont pas cliquables. */
  maxReached: number;
  onGo: (step: CreationStep) => void;
}

export function CreationStepper({ steps, current, maxReached, onGo }: Props) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Étapes de la saisie">
      {steps.map((s, i) => {
        const isCurrent = current === s.num;
        const isPast = current > s.num;
        const reachable = s.num <= maxReached;
        return (
          <li key={s.num} className={cn("flex items-center gap-1.5", i < steps.length - 1 && "flex-1")}>
            <button
              type="button"
              disabled={!reachable}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => onGo(s.num)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[13px] font-semibold transition-colors",
                "disabled:cursor-default",
                isCurrent
                  ? "border-primary bg-primary/[0.06] text-primary"
                  : isPast
                    ? "border-primary/30 bg-card text-foreground hover:bg-secondary/40"
                    : "border-border bg-card text-muted-foreground",
                reachable && !isCurrent && "cursor-pointer",
              )}
            >
              <span
                className={cn(
                  "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11.5px] font-extrabold",
                  isCurrent || isPast ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                {isPast ? <Check className="size-3" strokeWidth={3} /> : s.num}
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
