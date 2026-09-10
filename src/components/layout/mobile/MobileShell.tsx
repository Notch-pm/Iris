// Shell MOBILE — rendu à la place d'`AppShell` quand un téléphone est détecté
// (`Adaptive`). Barre haute compacte (tenant, cloche, compte), contenu
// défilant, barre d'onglets basse. Plein écran par nature : le gabarit
// demandé par les pages (`useFullBleedLayout`, `useWideLayout`) est reçu et
// ignoré — `ShellLayoutContext` est fourni avec un `setWidth` sans effet pour
// que les pages de bureau réutilisées ne cassent pas.
//
// Les insets de sécurité (`env(safe-area-inset-*)`) comptent : en application
// installée sur iPhone, la barre basse passe sous l'indicateur d'accueil.

import * as React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ChevronsUpDown, HardHat, Inbox, PlusCircle, User } from "lucide-react";
import notchLogo from "@/assets/logo-notch.svg";
import { Select } from "@/components/ui/select";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { useCanCreateRequest } from "@/features/requests/creation/useCanCreateRequest";
import { useTenant } from "@/features/tenant/TenantProvider";
import { useMyAvatarUrl } from "@/features/account/useAccount";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";
import { isNavRouteActive } from "../nav";
import { ShellLayoutContext } from "../shellLayout";
import { mobileNavItems, type MobileNavKey } from "./mobileNav";
import { MobileAccountSheet } from "./MobileAccountSheet";

const TAB_ICONS: Record<MobileNavKey, typeof Inbox> = {
  interventions: HardHat,
  demandes: Inbox,
  nouvelle: PlusCircle,
  compte: User,
};

function MobileTopBar({ onAccount }: { onAccount: () => void }) {
  const { profile, session } = useAuth();
  const { memberships, current, setCurrentOrgId } = useTenant();
  const avatarUrl = useMyAvatarUrl();
  const initials = profile
    ? ([profile.first_name?.[0], profile.last_name?.[0]].filter(Boolean).join("").toUpperCase()
      || profile.email[0].toUpperCase())
    : (session?.user.email?.[0]?.toUpperCase() ?? "U");

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 pt-[env(safe-area-inset-top)]">
      <Link to="/" className="shrink-0">
        <img src={notchLogo} alt="Notch — Iris" className="h-5 object-contain" />
      </Link>
      <div className="min-w-0 flex-1">
        {memberships.length > 1 ? (
          <Select
            aria-label="Organisation courante"
            className="h-8 w-full rounded-full border-border px-3 text-[13px] font-medium"
            value={current?.organizationId ?? ""}
            onChange={(e) => setCurrentOrgId(e.target.value)}
          >
            {memberships.map((m) => (
              <option key={m.organizationId} value={m.organizationId}>{m.organizationName}</option>
            ))}
          </Select>
        ) : current ? (
          <span className="block truncate text-sm font-medium text-muted-foreground">{current.organizationName}</span>
        ) : null}
      </div>
      <NotificationBell />
      <button
        type="button"
        aria-label="Mon compte"
        onClick={onAccount}
        className="flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted"
      >
        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initials}
        </span>
        <ChevronsUpDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </button>
    </header>
  );
}

function MobileTabBar() {
  const { rights } = useTenant();
  const canCreate = useCanCreateRequest();
  const { pathname } = useLocation();
  const items = mobileNavItems({ isIntervenant: rights.is_intervenant, canCreate });

  return (
    <nav
      aria-label="Navigation principale"
      className="shrink-0 border-t border-primary-foreground/10 bg-primary pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const Icon = TAB_ICONS[item.key];
          const active = isNavRouteActive(item, pathname);
          return (
            <li key={item.key} className="flex-1">
              <Link
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-semibold transition-colors",
                  active ? "text-primary-foreground" : "text-primary-foreground/70",
                )}
              >
                <span className={cn(
                  "flex h-7 w-11 items-center justify-center rounded-full",
                  active && "bg-primary-foreground/20",
                )}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                {item.label}
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
        <MobileTopBar onAccount={() => setAccountOpen(true)} />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {loading ? <p className="p-6 text-sm text-muted-foreground">Chargement…</p> : <Outlet />}
        </main>
        <MobileTabBar />
        <MobileAccountSheet open={accountOpen} onOpenChange={setAccountOpen} />
      </div>
    </ShellLayoutContext.Provider>
  );
}
