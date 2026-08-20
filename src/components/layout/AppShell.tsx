import { NavLink, Outlet } from "react-router-dom";
import { Inbox, LayoutDashboard, LogOut } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTenant } from "@/features/tenant/TenantProvider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard, end: true },
  { to: "/demandes", label: "Demandes", icon: Inbox, end: false },
];

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  superviseur: "Superviseur",
  agent: "Agent",
  lecteur: "Lecteur",
};

export function AppShell() {
  const { session, signOut } = useAuth();
  const { memberships, current, setCurrentOrgId, loading } = useTenant();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 items-center px-5 text-lg font-semibold tracking-tight">
          Iris
          <span className="ml-2 text-xs font-normal opacity-60">Edilumen</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-sidebar-active font-medium" : "hover:bg-sidebar-hover",
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-border bg-card px-6">
          <div className="flex items-center gap-2">
            {memberships.length > 1 ? (
              <Select
                aria-label="Tenant courant"
                className="h-9 w-auto min-w-[200px]"
                value={current?.organizationId ?? ""}
                onChange={(e) => setCurrentOrgId(e.target.value)}
              >
                {memberships.map((m) => (
                  <option key={m.organizationId} value={m.organizationId}>
                    {m.organizationName}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-sm font-medium">{current?.organizationName ?? ""}</span>
            )}
            {current ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {ROLE_LABELS[current.role] ?? current.role}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{session?.user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <LogOut />
              Déconnexion
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
