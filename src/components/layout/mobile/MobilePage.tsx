// Primitives des PAGES MOBILES (maquette Claude Design « Iris mobile — v2 »,
// 2026-09-14) : en-tête collant, pied collant, carte, titre de section,
// ligne d'action d'un tiroir, et les deux enveloppes de dialogue — feuille
// plein écran et tiroir bas. Toutes les pages mobiles les partagent pour que
// huit écrans se ressemblent sans se recopier.
//
// Les insets de sécurité (`env(safe-area-inset-*)`) sont posés ICI, une fois :
// en application installée sur iPhone, l'en-tête passe sous l'encoche et le
// pied sous l'indicateur d'accueil.

import * as React from "react";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// En-tête et pied
// ---------------------------------------------------------------------------

interface HeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** `back` = flèche (navigation), `close` = croix (dialogue), `none` = rien. */
  leading?: "back" | "close" | "none";
  onLeading?: () => void;
  /** Ce qui se pose à droite (cloche, menu ⋯, pastille). */
  trailing?: React.ReactNode;
  /** Sous l'en-tête, dans la même surface : recherche, puces de filtre… */
  children?: React.ReactNode;
  /** Le titre est un `DialogTitle` (feuille) plutôt qu'un `h1` (page). */
  asDialogTitle?: boolean;
  className?: string;
}

export function MobileHeader({
  title, subtitle, leading = "none", onLeading, trailing, children, asDialogTitle = false, className,
}: HeaderProps) {
  const Title = asDialogTitle ? DialogTitle : "h1";
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex shrink-0 flex-col gap-3 border-b border-border bg-card px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.75rem)]",
        className,
      )}
    >
      <div className="flex min-h-11 items-center gap-1.5">
        {leading !== "none" ? (
          <button
            type="button"
            aria-label={leading === "back" ? "Retour" : "Fermer"}
            onClick={onLeading}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary transition-colors hover:bg-secondary active:scale-[0.98]"
          >
            {leading === "back"
              ? <ArrowLeft className="size-6" aria-hidden="true" />
              : <X className="size-[22px] text-foreground" aria-hidden="true" />}
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col px-1">
          <Title className="truncate text-[17px] font-bold leading-tight">{title}</Title>
          {subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null}
        </div>
        {trailing ? <div className="flex shrink-0 items-center gap-1">{trailing}</div> : null}
      </div>
      {children}
    </header>
  );
}

interface FooterProps {
  children: React.ReactNode;
  /** Une ligne grise sous le bouton : ce qui va se passer (« L'usager recevra un courriel »). */
  hint?: React.ReactNode;
  /** Dans une feuille (dialogue), le pied porte lui-même l'inset bas ; dans une page, la barre d'onglets s'en charge. */
  safeArea?: boolean;
  className?: string;
}

export function MobileFooter({ children, hint, safeArea = false, className }: FooterProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-30 flex shrink-0 flex-col gap-2 border-t border-border bg-card px-4 pt-3",
        safeArea ? "pb-[calc(env(safe-area-inset-bottom)+1rem)]" : "pb-4",
        className,
      )}
    >
      {children}
      {hint ? <p className="text-center text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contenu
// ---------------------------------------------------------------------------

/** Carte blanche à coins 14 px, ombre légère — l'unité de la liste et de la fiche. */
export function MobileCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3.5 shadow-airbnb-sm", className)}
      {...props}
    />
  );
}

/** Carte CLIQUABLE (toute la surface), avec le chevron de la maquette. */
export function MobileCardButton({ className, children, chevron = true, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { chevron?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-start gap-2.5 rounded-[14px] border border-border bg-card p-3.5 text-left shadow-airbnb-sm transition-colors hover:bg-muted/40 active:scale-[0.99]",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
      {chevron ? <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground/70" aria-hidden="true" /> : null}
    </button>
  );
}

interface SectionProps {
  /** « 1 · Photo de la situation » : le numéro est posé par l'appelant. */
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function MobileSection({ title, hint, action, children, className }: SectionProps) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-extrabold leading-tight">{title}</h2>
        {action}
      </div>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </section>
  );
}

/** Petit libellé gris d'un groupe de liste (« Aujourd'hui », « Cette semaine »). */
export function MobileGroupLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[13px] font-bold text-muted-foreground", className)}>{children}</p>;
}

interface ActionRowProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  disabled?: boolean;
  /** Pourquoi la ligne est fermée — écrit, jamais un gris muet. */
  disabledReason?: string | null;
  onClick: () => void;
}

/** Ligne d'un tiroir d'actions : icône, titre, sous-titre, chevron — 60 px de haut, au pouce. */
export function MobileActionRow({ icon, title, sub, disabled = false, disabledReason, onClick }: ActionRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? disabledReason ?? undefined : undefined}
      onClick={onClick}
      className="flex min-h-[60px] w-full items-center gap-3.5 border-t border-border/70 px-1 text-left transition-colors hover:bg-muted/40 disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="flex size-6 shrink-0 items-center justify-center text-primary [&_svg]:size-[22px]">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-bold leading-tight">{title}</span>
        {disabled && disabledReason
          ? <span className="text-[13px] text-muted-foreground">{disabledReason}</span>
          : sub ? <span className="text-[13px] text-muted-foreground">{sub}</span> : null}
      </span>
      <ChevronRight className="size-[18px] shrink-0 text-muted-foreground/70" aria-hidden="true" />
    </button>
  );
}

/** Bouton d'action rapide (« Écrire », « Statut », « Photo ») : icône au-dessus du mot. */
export function MobileQuickAction({ icon, label, disabled, disabledReason, onClick }: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  disabledReason?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? disabledReason ?? undefined : undefined}
      onClick={onClick}
      className="flex h-16 flex-1 flex-col items-center justify-center gap-1 rounded-[14px] border border-border bg-card text-primary shadow-airbnb-sm transition-colors hover:bg-muted/40 active:scale-[0.98] disabled:opacity-40 [&_svg]:size-[22px]"
    >
      {icon}
      <span className="text-xs font-bold text-foreground">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Dialogues mobiles
// ---------------------------------------------------------------------------

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Bloqué pendant un envoi : la croix ne ferme plus. */
  locked?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Feuille PLEIN ÉCRAN : en-tête avec croix, contenu défilant, pied collant.
 * C'est la forme mobile d'un `Dialog` de formulaire.
 */
export function MobileSheet({ open, onOpenChange, title, subtitle, locked = false, footer, children }: SheetProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && locked) return; onOpenChange(o); }}>
      <DialogContent variant="sheet" hideClose className="flex flex-col overflow-hidden p-0 pb-0 pt-0">
        <MobileHeader
          title={title}
          subtitle={subtitle}
          leading="close"
          onLeading={() => { if (!locked) onOpenChange(false); }}
          asDialogTitle
          className="static"
        />
        {/* `[&>*]:shrink-0` : dans une colonne flex qui défile, un enfant à
            `overflow-hidden` (une liste à coins arrondis) se laisserait écraser à
            zéro dès que le contenu dépasse — vu en navigateur sur la feuille Statut. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-background px-4 py-4 [&>*]:shrink-0">
          {children}
        </div>
        {footer ? <MobileFooter safeArea className="static">{footer}</MobileFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}

/** Tiroir bas : titre, lignes d'action (`MobileActionRow`), bouton Annuler. */
export function MobileDrawer({ open, onOpenChange, title, subtitle, children }: DrawerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="drawer" hideClose>
        <div className="flex flex-col gap-0.5 px-1 pb-2.5">
          <DialogTitle className="text-xl font-extrabold leading-tight">{title}</DialogTitle>
          {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex flex-col border-b border-border/70">{children}</div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-[14px] border border-border bg-background text-base font-bold text-muted-foreground transition-colors hover:bg-secondary active:scale-[0.98]"
        >
          Annuler
        </button>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Petits utilitaires d'écran
// ---------------------------------------------------------------------------

/** Puce de filtre (« Affectées 7 ») : pleine quand active, blanche sinon. */
export function MobileChip({ active, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors active:scale-[0.98]",
        active ? "bg-primary font-bold text-primary-foreground" : "border border-border bg-card text-foreground hover:bg-secondary",
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** Message d'état plein écran (chargement, vide, erreur), centré. */
export function MobileEmpty({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "error" }) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cn(
        "rounded-[14px] px-4 py-6 text-center text-sm",
        tone === "error" ? "border border-destructive/30 bg-destructive/5 text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

/** Bandeau d'information ambré (« 2 demandes arrivent à échéance aujourd'hui »). */
export function MobileNotice({ icon, children, tone = "warn" }: { icon?: React.ReactNode; children: React.ReactNode; tone?: "warn" | "ok" | "error" }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm font-semibold [&_svg]:size-5 [&_svg]:shrink-0",
        tone === "warn" && "border-secondary/60 bg-secondary/20 text-secondary-foreground",
        tone === "ok" && "border-primary/30 bg-primary/[0.06] text-primary",
        tone === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
