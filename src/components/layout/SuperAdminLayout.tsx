import { NavLink, Link, Outlet } from "react-router-dom";
import { ArrowLeft, Gauge, Landmark, LogOut, ShieldCheck, UserCog } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/superadmin", label: "Organisations", icon: Landmark, end: true },
  { to: "/superadmin/utilisateurs", label: "Utilisateurs", icon: UserCog, end: false },
  { to: "/superadmin/ia", label: "Plafonds IA", icon: Gauge, end: false },
];

/** Zone superadmin — shell séparé (motif Socle/Clara : deux zones, deux menus). */
export function SuperAdminLayout() {
  const { session, signOut } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 items-center gap-2 px-5 text-lg font-semibold tracking-tight">
          <ShieldCheck className="size-5 text-secondary" />
          Iris
          <span className="text-xs font-normal opacity-60">Superadmin</span>
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
        <div className="px-3 pb-4">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm opacity-80 transition-colors hover:bg-sidebar-hover hover:opacity-100"
          >
            <ArrowLeft className="size-4" />
            Retour à l'application
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-end gap-4 border-b border-border bg-card px-6">
          <span className="text-sm text-muted-foreground">{session?.user.email}</span>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOut />
            Déconnexion
          </Button>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
