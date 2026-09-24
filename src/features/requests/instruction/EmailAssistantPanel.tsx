// Bandeau « Assistant IA » du composeur des échanges — ergonomie de
// l'assistant de réponse de Clara (`ReplyComposer`) : replié par défaut, un
// type de réponse en pastilles, des instructions complémentaires, « Générer la
// réponse ». Pas de « Clôture » : l'avis de clôture d'Iris est composé par le
// serveur au moment de clore.
//
// Comme chez Clara, le bandeau n'existe que devant un message VIDE (le parent
// en décide) : générer ne remplace jamais ce que l'agent a écrit. Couleurs du
// design system — pas le violet de Clara.

import * as React from "react";
import { ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DRAFT_KIND_OPTIONS, type DraftKind } from "./useEmailAssistant";

interface Props {
  disabled: boolean;
  pending: boolean;
  onGenerate: (input: { kind: DraftKind; instructions: string }) => void;
}

export function EmailAssistantPanel({ disabled, pending, onGenerate }: Props) {
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<DraftKind | null>(null);
  const [instructions, setInstructions] = React.useState("");
  const panelId = React.useId();

  return (
    <div className="border-b border-border bg-primary/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] font-semibold text-primary transition-colors hover:bg-primary/[0.06]"
      >
        <Sparkles className="size-4" aria-hidden="true" />
        Assistant IA
        {open ? <ChevronUp className="ml-auto size-4" aria-hidden="true" /> : <ChevronDown className="ml-auto size-4" aria-hidden="true" />}
      </button>

      {open ? (
        <div id={panelId} className="flex flex-col gap-3 px-4 pb-3.5 pt-1">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-semibold text-muted-foreground">Type de réponse</legend>
            <div className="flex flex-wrap gap-1.5">
              {DRAFT_KIND_OPTIONS.map((o) => {
                const on = kind === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={disabled || pending}
                    onClick={() => setKind(o.value)}
                    className={cn(
                      "h-8 rounded-full border px-3.5 text-[12.5px] font-semibold transition-colors disabled:opacity-50",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:border-primary/50",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Instructions complémentaires</span>
            <textarea
              rows={2}
              value={instructions}
              disabled={disabled || pending}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Ex : rappeler que l'intervention est prévue la semaine prochaine, ton chaleureux…"
              className="w-full resize-y rounded-[10px] border border-input bg-background px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[11.5px] leading-snug text-muted-foreground">
              Brouillon à relire. L'assistant connaît la demande, sa démarche et ses interventions —
              ni vos notes internes, ni l'identité de l'usager.
            </span>
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              disabled={disabled || pending || kind === null}
              onClick={() => { if (kind) onGenerate({ kind, instructions }); }}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {pending ? "Génération en cours…" : "Générer la réponse"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
