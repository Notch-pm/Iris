// Bascules d'activation, partagées par les deux modales.
//
// Le même couple (modèle, organisation) se règle depuis deux angles :
//   · depuis un MODÈLE → « dans quelles organisations est-il actif ? »
//   · depuis une ORGANISATION → « quels modèles y sont actifs ? »
// Une seule bascule pour les deux, donc un seul comportement à corriger le
// jour où il faudra le corriger.

import * as React from "react";
import { cn } from "@/lib/utils";

interface ToggleProps {
  id: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  /** Ligne secondaire — description du modèle, ou organisation obsolète. */
  hint?: string;
  /** Décalage d'arborescence, en niveaux. */
  depth?: number;
  onChange: (next: boolean) => void;
}

export function OrganisationToggle({
  id, checked, disabled, label, hint, depth = 0, onChange,
}: ToggleProps) {
  return (
    <label
      htmlFor={id}
      style={{ paddingLeft: `${depth * 20}px` }}
      className={cn(
        "flex items-start gap-3 rounded-lg px-2 py-2 transition-colors",
        disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/60",
      )}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-medium">{label}</span>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ToggleListEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted-foreground">
      {children}
    </p>
  );
}
