import * as React from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ChevronsUpDown, Inbox, LayoutDashboard, LogOut, ShieldCheck } from "lucide-react";
import notchLogo from "@/assets/logo-notch.svg";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ShellLayoutContext } from "./shellLayout";

// Shell agent — réplique du shell de production Clara (AppHeader h-14 +
// AppSidebar : rail vert 52px, premier item épinglé en haut, groupe restant
// centré verticalement). Design system Notch/Ariane.

const NAV_ITEMS = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard, end: true },
  { to: "/demandes", label: "Demandes", icon: Inbox, end: false },
];

const ROLE_LABELS: Record<string, string> = {
  administrateur: "Administrateur",
  agent: "Agent",
};

function SidebarItem({ item }: { item: (typeof NAV_ITEMS)[number] }) {
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
  const [first, ...rest] = NAV_ITEMS;
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
  const { current } = useTenant();
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
  const roleName = current ? (ROLE_LABELS[current.role] ?? current.role) : "—";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted focus:outline-none"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
          {initials}
        </span>
        <ChevronsUpDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-40 min-w-[220px] rounded-xl border border-border bg-popover p-1.5 shadow-airbnb-lg"
        >
          <div className="px-2.5 py-2">
            <p className="text-[13px] font-semibold">{displayName}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{roleName}</p>
          </div>
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
  const { memberships, current, setCurrentOrgId, loading } = useTenant();
  const [fullBleed, setFullBleed] = React.useState(false);
  const layoutValue = React.useMemo(() => ({ setFullBleed }), []);

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

        {/* Droite : superadmin (plateforme uniquement) + menu utilisateur */}
        <div className="flex shrink-0 items-center gap-2">
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
          <UserMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        {fullBleed ? (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {loading ? (
              <p className="p-6 text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <Outlet />
            )}
          </main>
        ) : (
          <main className="flex-1 overflow-auto px-6 py-5 pb-10">
            <div className="mx-auto max-w-[1240px]">
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
