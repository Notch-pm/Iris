// Shell MOBILE — rendu à la place d'`AppShell` quand un téléphone est détecté
// (`Adaptive`). Maquette « Iris mobile — v2 » (2026-09-14) : PAS de barre
// haute commune — chaque page mobile porte son en-tête (`MobileHeader`), avec
// son retour, sa cloche ou son menu ; en application installée il n'y a pas de
// barre d'adresse, l'en-tête de la page est le seul repère. En bas, la barre
// d'onglets sombre avec « Créer » au centre, et « Moi » qui ouvre la feuille du
// compte sur place.
//
// Plein écran par nature : le gabarit demandé par les pages
// (`useFullBleedLayout`, `useWideLayout`) est reçu et ignoré —
// `ShellLayoutContext` est fourni avec un `setWidth` sans effet pour que les
// pages de bureau réutilisées ne cassent pas.
//
// Les insets de sécurité (`env(safe-area-inset-*)`) comptent : en application
// installée sur iPhone, la barre basse passe sous l'indicateur d'accueil.

import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";
import { HardHat, Inbox, Plus, User } from "lucide-react";
import { useCanCreateRequest } from "@/features/requests/creation/useCanCreateRequest";
import { useTenant } from "@/features/tenant/TenantProvider";
import { cn } from "@/lib/utils";
import { isNavRouteActive } from "../nav";
import { ShellLayoutContext } from "../shellLayout";
import { mobileNavItems } from "./mobileNav";
import { MobileAccountSheet } from "./MobileAccountSheet";

const TAB_ICONS = {
  demandes: Inbox,
  interventions: HardHat,
  moi: User,
} as const;

function TabLabel({ active, icon: Icon, label }: { active: boolean; icon: typeof Inbox; label: string }) {
  return (
    <>
      <Icon className={cn("size-6", active ? "text-primary-bright" : "text-sidebar-foreground/70")} aria-hidden="true" />
      <span className={cn("text-[11px] leading-none", active ? "font-bold text-primary-bright" : "font-semibold text-sidebar-foreground/70")}>
        {label}
      </span>
    </>
  );
}

function MobileTabBar({ onAccount, accountOpen }: { onAccount: () => void; accountOpen: boolean }) {
  const { rights } = useTenant();
  const canCreate = useCanCreateRequest();
  const { pathname } = useLocation();
  const items = mobileNavItems({ isIntervenant: rights.is_intervenant, canCreate });

  return (
    <nav
      aria-label="Navigation principale"
      className="shrink-0 bg-sidebar px-2.5 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2"
    >
      <ul className="flex items-center">
        {items.map((item) => {
          if (item.kind === "create") {
            const active = isNavRouteActive(item.route, pathname);
            return (
              <li key={item.key} className="flex w-[76px] shrink-0 justify-center">
                <Link
                  to={item.route.to}
                  aria-current={active ? "page" : undefined}
                  aria-label="Créer une demande"
                  className={cn(
                    "flex size-[60px] flex-col items-center justify-center gap-px rounded-full bg-primary text-primary-foreground shadow-[0_6px_20px_-4px_hsl(var(--primary-bright)/0.5)] transition-transform active:scale-[0.96]",
                    active && "ring-4 ring-primary-bright/40",
                  )}
                >
                  <Plus className="size-[26px]" strokeWidth={2.2} aria-hidden="true" />
                  <span className="text-[9px] font-extrabold tracking-wide">CRÉER</span>
                </Link>
              </li>
            );
          }
          if (item.kind === "account") {
            return (
              <li key={item.key} className="flex-1">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={accountOpen}
                  onClick={onAccount}
                  className="flex min-h-[52px] w-full flex-col items-center justify-center gap-1.5 px-1"
                >
                  <TabLabel active={accountOpen || pathname === "/mon-compte"} icon={TAB_ICONS.moi} label={item.label} />
                </button>
              </li>
            );
          }
          const active = isNavRouteActive(item.route, pathname);
          return (
            <li key={item.key} className="flex-1">
              <Link
                to={item.route.to}
                aria-current={active ? "page" : undefined}
                className="flex min-h-[52px] flex-col items-center justify-center gap-1.5 px-1"
              >
                <TabLabel active={active} icon={TAB_ICONS[item.key]} label={item.label} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function MobileShell() {
  const { loading } = useTenant();
  const [accountOpen, setAccountOpen] = React.useState(false);
  // Le mobile est toujours plein écran : le gabarit demandé par la page est ignoré.
  const layoutValue = React.useMemo(() => ({ setWidth: () => undefined }), []);

  return (
    <ShellLayoutContext.Provider value={layoutValue}>
      <div className="flex h-dvh flex-col bg-background">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {loading ? <p className="p-6 text-sm text-muted-foreground">Chargement…</p> : <Outlet />}
        </main>
        <MobileTabBar onAccount={() => setAccountOpen(true)} accountOpen={accountOpen} />
        <MobileAccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
      </div>
    </ShellLayoutContext.Provider>
  );
}
