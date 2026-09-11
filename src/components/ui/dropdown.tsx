import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

// Menu flottant minimal (popover ancré sous son déclencheur) : fermeture au
// clic extérieur et à Échap. Suffisant pour les sélecteurs de la fiche
// d'instruction (urgence, affectation, actions secondaires) — motif `ar-pop`
// du design system.
//
// `portal` détache le menu dans le `body`, en position fixe : un déclencheur
// posé DANS une zone défilante (colonne du tableau des demandes) verrait sinon
// son menu rogné par le débordement de cette zone.

interface DropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Déclencheur — reçoit les attributs d'accessibilité à poser sur le bouton. */
  trigger: (props: { "aria-expanded": boolean; "aria-haspopup": "menu" | "dialog"; onClick: () => void }) => React.ReactNode;
  align?: "left" | "right";
  /** Côté d'ouverture — `top` pour un déclencheur en bas d'une zone défilante. */
  side?: "bottom" | "top";
  /** Menu détaché dans le `body` : indispensable en zone défilante, inutile ailleurs. */
  portal?: boolean;
  /** Rôle ARIA du panneau — `menu` par défaut ; `dialog` pour un panneau de filtres à cases. */
  role?: "menu" | "dialog";
  /** Libellé accessible du panneau (utile avec `role="dialog"`). */
  ariaLabel?: string;
  className?: string;
  menuClassName?: string;
  children: React.ReactNode;
}

const MENU_BASE =
  "flex min-w-[250px] max-w-[calc(100vw-24px)] flex-col gap-0.5 rounded-[13px] border border-border bg-popover p-[7px] shadow-airbnb-xl";

export function Dropdown({
  open, onOpenChange, trigger, align = "right", side = "bottom",
  portal = false, role = "menu", ariaLabel, className, menuClassName, children,
}: DropdownProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  // Le menu détaché sort du conteneur : le clic extérieur doit l'épargner lui aussi.
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = React.useState<React.CSSProperties | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  // Position du menu détaché : posée à l'ouverture, puis suivie au défilement
  // (`capture` — la zone qui défile n'est pas la fenêtre) et au redimensionnement.
  React.useEffect(() => {
    if (!open || !portal) {
      setAnchor(null);
      return;
    }
    const place = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      setAnchor({
        position: "fixed",
        ...(side === "top" ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
        ...(align === "right" ? { right: window.innerWidth - r.right } : { left: r.left }),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, portal, align, side]);

  const menu = open ? (
    <div
      ref={menuRef}
      role={role}
      aria-label={ariaLabel}
      style={anchor ?? undefined}
      className={cn(
        MENU_BASE,
        portal
          ? "z-50"
          : cn(
              "absolute z-20",
              side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
              align === "right" ? "right-0" : "left-0",
            ),
        menuClassName,
      )}
    >
      {children}
    </div>
  ) : null;

  return (
    <div ref={ref} className={cn("relative", className)}>
      {trigger({ "aria-expanded": open, "aria-haspopup": role, onClick: () => onOpenChange(!open) })}
      {portal ? (menu && anchor ? createPortal(menu, document.body) : null) : menu}
    </div>
  );
}

interface DropdownItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function DropdownItem({ active, className, children, ...props }: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-[9px] rounded-[9px] px-[9px] py-2 text-left text-[12.5px] font-semibold text-foreground transition-colors",
        "hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
        active && "bg-primary/[0.07]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return <span className="px-1 pb-1 pt-0.5 text-[10.5px] font-bold text-muted-foreground">{children}</span>;
}

export function DropdownDivider() {
  return <span className="my-[5px] h-px bg-border" aria-hidden="true" />;
}
