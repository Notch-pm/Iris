// « Notifications sur cet appareil » — un composant, deux hôtes (la page
// « Mon compte » et la feuille « Moi » du mobile). Interrupteur DS
// (`role="switch"`), sous-texte par état, erreur écrite. Il ne décide rien :
// `usePushSubscription` lit et agit, `src/lib/push.ts` porte les règles.

import { BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { PUSH_COPY, PUSH_FOOTNOTE } from "@/lib/push";
import { usePushSubscription } from "./usePushSubscription";

interface Props {
  /** La page « Mon compte » affiche le rappel « cet appareil, ce navigateur » ; la feuille mobile l'omet. */
  footnote?: boolean;
  className?: string;
}

export function PushDeviceToggle({ footnote = false, className }: Props) {
  const { state, loading, busy, error, enable, disable } = usePushSubscription();
  const on = state === "on";
  const canToggle = !loading && !busy && (state === "on" || state === "off");
  const id = "push-device-toggle";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-start gap-3">
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={on}
          aria-busy={busy || undefined}
          disabled={!canToggle}
          onClick={() => void (on ? disable() : enable())}
          className={cn(
            "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
            on ? "bg-primary" : "bg-muted-foreground/30",
            !canToggle && "opacity-50",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
              on ? "left-0.5 translate-x-5" : "left-0.5 translate-x-0",
            )}
          />
        </button>
        <label htmlFor={id} className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <BellRing className="size-4 text-primary" aria-hidden="true" />
            Notifications sur cet appareil
          </span>
          <span className="text-xs text-muted-foreground">
            {loading ? "Vérification…" : PUSH_COPY[state].hint}
          </span>
        </label>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {footnote ? <p className="text-xs text-muted-foreground">{PUSH_FOOTNOTE}</p> : null}
    </div>
  );
}
