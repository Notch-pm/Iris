import * as React from "react";
import { cn } from "@/lib/utils";

// Menu flottant minimal (popover ancré sous son déclencheur) : fermeture au
// clic extérieur et à Échap. Suffisant pour les sélecteurs de la fiche
// d'instruction (urgence, affectation, actions secondaires) — motif `ar-pop`
// du design system.

interface DropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Déclencheur — reçoit les attributs d'accessibilité à poser sur le bouton. */
  trigger: (props: { "aria-expanded": boolean; "aria-haspopup": "menu"; onClick: () => void }) => React.ReactNode;
  align?: "left" | "right";
  /** Côté d'ouverture — `top` pour un déclencheur en bas d'une zone défilante. */
  side?: "bottom" | "top";
  className?: string;
  menuClassName?: string;
  children: React.ReactNode;
}

export function Dropdown({
  open, onOpenChange, trigger, align = "right", side = "bottom", className, menuClassName, children,
}: DropdownProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
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

  return (
    <div ref={ref} className={cn("relative", className)}>
      {trigger({ "aria-expanded": open, "aria-haspopup": "menu", onClick: () => onOpenChange(!open) })}
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute z-20 flex min-w-[250px] max-w-[calc(100vw-24px)] flex-col gap-0.5 rounded-[13px] border border-border bg-popover p-[7px] shadow-airbnb-xl",
            side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
            align === "right" ? "right-0" : "left-0",
            menuClassName,
          )}
        >
          {children}
        </div>
      ) : null}
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
