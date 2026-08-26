import * as React from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ChevronsUpDown, Inbox, LayoutDashboard, LogOut, Map, ShieldCheck, User, Users } from "lucide-react";
import parametresIcon from "@/assets/icons/parametres.svg";
import notchLogo from "@/assets/logo-notch.svg";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/features/auth/AuthProvider";
import { useCanBrowseUsagers } from "@/features/contacts/useUsagers";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { useMyAvatarUrl } from "@/features/account/useAccount";
import { useTenant } from "@/features/tenant/TenantProvider";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ShellLayoutContext, type ShellWidth } from "./shellLayout";

// Shell agent — réplique du shell de production Clara (AppHeader h-14, dont
// l'accès aux Paramètres en haut à droite + AppSidebar : rail vert 52px,
// premier item épinglé en haut, groupe restant centré verticalement). Design
// system Notch/Ariane.

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end: boolean;
}

const BASE_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard, end: true },
  { to: "/demandes", label: "Demandes", icon: Inbox, end: false },
  { to: "/carte", label: "Carte des interventions", icon: Map, end: false },
];

// L'annuaire des usagers exige le même droit que « Nouvelle demande » (garde de
// socle-proxy sur /v1/contacts/*) : l'entrée n'apparaît que s'il est acquis —
// reflet de confort, l'edge function reste l'autorité.
const USAGERS_NAV_ITEM: NavItem = {
  to: "/usagers", label: "Usagers", icon: Users, end: false,
};

function SidebarItem({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.end}
        title={item.label}
        className={({ isActive }) =>
          cn(
            "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
            isActive
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground",
          )
        }
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
        <span className="sr-only">{item.label}</span>
      </NavLink>
    </li>
  );
}

function AppSidebar() {
  const canBrowseUsagers = useCanBrowseUsagers();
  const items = canBrowseUsagers
    ? [...BASE_NAV_ITEMS, USAGERS_NAV_ITEM]
    : BASE_NAV_ITEMS;
  const [first, ...rest] = items;
  return (
    <nav
      aria-label="Navigation principale"
      className="relative flex h-full w-[52px] shrink-0 flex-col items-center bg-primary py-3"
    >
      <ul className="contents">
        <SidebarItem item={first} />
      </ul>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <ul className="pointer-events-auto flex flex-col items-center gap-0.5">
          {rest.map((item) => (
            <SidebarItem key={item.to} item={item} />
          ))}
        </ul>
      </div>
    </nav>
  );
}

function UserMenu() {
  const { session, profile, signOut } = useAuth();
  const { isAdmin, rights } = useTenant();
  const avatarUrl = useMyAvatarUrl();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const displayName = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.email
    : (session?.user.email ?? "Utilisateur");
  const initials = profile
    ? ([profile.first_name?.[0], profile.last_name?.[0]].filter(Boolean).join("").toUpperCase() ||
      profile.email[0].toUpperCase())
    : "U";
  // RM-46 : le badge de rôle est remplacé par les profils de droits attribués
  // sur ce tenant — c'est la seule réponse fiable à « pourquoi ne puis-je pas
  // faire ceci ? », le rôle binaire n'existant plus dans le modèle de droits.
  const activeProfiles = rights.profiles.filter((p) => p.status === "active");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted focus:outline-none"
      >
        <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary font-bold text-primary-foreground">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </span>
        <ChevronsUpDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-40 min-w-[240px] rounded-xl border border-border bg-popover p-1.5 shadow-airbnb-lg"
        >
          <div className="px-2.5 py-2">
            <p className="text-[13px] font-semibold">{displayName}</p>
            {isAdmin ? (
              <Badge variant="secondary" className="mt-1.5">
                Administrateur
              </Badge>
            ) : null}
            <p className="mt-1.5 text-[11px] font-semibold text-muted-foreground">Profils attribués</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {rights.is_platform_admin
                ? "Administrateur de la plateforme"
                : activeProfiles.length > 0
                  ? activeProfiles.map((p) => p.name).join(", ")
                  : "Aucun"}
            </p>
          </div>
          <div className="my-1 h-px bg-border" />
          <NavLink
            role="menuitem"
            to="/mon-compte"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-muted"
          >
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            Mon compte
          </NavLink>
          <div className="my-1 h-px bg-border" />
          <button
            role="menuitem"
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Déconnexion
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const { profile } = useAuth();
  const { memberships, current, setCurrentOrgId, loading, isAdmin } = useTenant();
  const [width, setWidth] = React.useState<ShellWidth>("default");
  const layoutValue = React.useMemo(() => ({ setWidth }), []);

  return (
    <ShellLayoutContext.Provider value={layoutValue}>
    <div className="flex h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
        {/* Gauche : wordmark Notch + séparateur + tenant */}
        <div className="flex shrink-0 items-center gap-3">
          <Link to="/">
            <img src={notchLogo} alt="Notch — Iris" className="h-6 object-contain" />
          </Link>
          {memberships.length > 1 ? (
            <>
              <span className="h-6 w-px bg-border" aria-hidden="true" />
              <Select
                aria-label="Organisation courante"
                className="h-8 w-auto min-w-[180px] rounded-full border-border px-3 text-[13px] font-medium"
                value={current?.organizationId ?? ""}
                onChange={(e) => setCurrentOrgId(e.target.value)}
              >
                {memberships.map((m) => (
                  <option key={m.organizationId} value={m.organizationId}>
                    {m.organizationName}
                  </option>
                ))}
              </Select>
            </>
          ) : current ? (
            <>
              <span className="h-6 w-px bg-border" aria-hidden="true" />
              <span className="text-sm font-medium text-muted-foreground">
                {current.organizationName}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex-1" />

        {/* Droite : chip administrateur + superadmin (plateforme uniquement) + menu utilisateur */}
        <div className="flex shrink-0 items-center gap-2">
          {isAdmin ? (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              Administrateur
            </Badge>
          ) : null}
          {profile?.is_platform_admin ? (
            <Link
              to="/superadmin"
              title="Superadmin"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              <span className="sr-only">Superadmin</span>
            </Link>
          ) : null}
          {/* Notifications : cloche du tenant courant, à gauche des
              Paramètres. Le RLS ne montre que les siennes. */}
          <NotificationBell />
          {/* Accès aux Paramètres : en haut à droite, avec l'icône de Clara
              (`assets/icons/parametres.svg`, recopiée telle quelle) — RM-20,
              l'accès réel reste gardé par le RLS et `AdminRoute`. */}
          {isAdmin ? (
            <NavLink
              to="/parametres"
              title="Paramètres"
              className={({ isActive }) =>
                cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <img src={parametresIcon} alt="" aria-hidden="true" className="h-5 w-5" />
              <span className="sr-only">Paramètres</span>
            </NavLink>
          ) : null}
          <UserMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        {width === "full" ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <Outlet />
            )}
          </main>
        ) : (
          <main className="min-w-0 flex-1 overflow-auto px-6 py-5 pb-10">
            <div className={cn("mx-auto", width === "wide" ? "w-full" : "max-w-[1240px]")}>
              {loading ? (
                <p className="text-sm text-muted-foreground">Chargement…</p>
              ) : (
                <Outlet />
              )}
            </div>
          </main>
        )}
      </div>
    </div>
    </ShellLayoutContext.Provider>
  );
}
