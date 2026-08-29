// Bascule du rail : « Demande » (le dossier) / « Procédure » (ce que le
// service attend sur cette démarche). Même contrôle au guichet et à
// l'instruction — design Claude Design « Parcours demande ».
//
// La pastille sur « Procédure » signale qu'il y a quelque chose à lire sans
// obliger à aller voir : elle disparaît dès que l'onglet est ouvert.

import { cn } from "@/lib/utils";

export type RailTab = "demande" | "procedure";

interface Props {
  value: RailTab;
  onChange: (tab: RailTab) => void;
  /** Vrai quand la base de connaissances porte au moins un bloc. */
  hasKnowledge: boolean;
}

const TAB_BASE =
  "flex h-[30px] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors";

export function RailTabs({ value, onChange, hasKnowledge }: Props) {
  return (
    <div role="tablist" aria-label="Contenu du rail" className="flex gap-1 rounded-[10px] bg-muted p-1">
      {(["demande", "procedure"] as const).map((tab) => {
        const active = value === tab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab)}
            className={cn(
              TAB_BASE,
              active ? "bg-card text-foreground shadow-airbnb-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "demande" ? "Demande" : "Procédure"}
            {tab === "procedure" && hasKnowledge && !active ? (
              <span aria-hidden="true" className="block size-[5px] rounded-full bg-primary" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
