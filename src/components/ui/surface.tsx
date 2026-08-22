import * as React from "react";
import { cn } from "@/lib/utils";

// Briques visuelles des fiches (design Claude Design « Suivi demande »,
// reprises par la fiche usager) : surface, en-tête de section, avatar,
// pastille, cellule libellé/valeur, et le marqueur commun des fonctionnalités
// non encore livrées (grisées, jamais cachées — décision PO 2026-08-22 : on
// les travaillera ensuite).

/** Attributs à poser sur tout bouton d'une fonctionnalité à venir. */
export const SOON = {
  disabled: true,
  title: "Fonctionnalité à venir — bientôt disponible",
  "aria-disabled": true,
} as const;

export function Surface({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3.5 rounded-[14px] border border-border bg-card px-[18px] py-4 shadow-airbnb-sm",
        className,
      )}
      {...props}
    />
  );
}

interface SurfaceHeadProps {
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
}

export function SurfaceHead({ title, sub, action }: SurfaceHeadProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-[15px] font-bold leading-tight">{title}</h3>
        {sub ? <small className="text-xs text-muted-foreground">{sub}</small> : null}
      </div>
      {action}
    </div>
  );
}

interface AvatarProps {
  initials: string;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
  className?: string;
}

const AVATAR_SIZE = {
  sm: "h-6 w-6 text-[9.5px]",
  md: "h-[30px] w-[30px] text-[11px]",
  lg: "h-10 w-10 text-sm",
} as const;

export function Avatar({ initials, size = "md", muted = false, className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-extrabold",
        AVATAR_SIZE[size],
        muted ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
        className,
      )}
    >
      {initials}
    </span>
  );
}

export type PillTone = "ok" | "pending" | "error" | "neutral" | "dark";

const PILL_TONE: Record<PillTone, string> = {
  ok: "bg-primary/10 text-primary",
  pending: "bg-secondary/40 text-secondary-foreground",
  error: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
  dark: "bg-sidebar text-primary-foreground",
};

export function Pill({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: PillTone }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] text-[10.5px] font-bold",
        PILL_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Ligne « libellé / valeur » de la grille des informations saisies. */
export function InfoCell({ label, value, full = false, mono = false }: {
  label: string;
  value: React.ReactNode;
  full?: boolean;
  mono?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-[3px] border-b border-border pb-[9px]", full && "col-span-full")}>
      <span className="text-[11px] font-semibold leading-snug text-muted-foreground">{label}</span>
      <span className={cn("break-words text-[13.5px] font-semibold leading-snug", mono && "font-mono text-xs")}>
        {value}
      </span>
    </div>
  );
}
