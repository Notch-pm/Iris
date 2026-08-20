import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthProvider";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      Chargement…
    </div>
  );
}

/** Zone authentifiée. Les droits réels sont portés par le RLS — cette garde ne fait que router. */
export function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return <Outlet />;
}

/** Zone superadmin — réservée aux administrateurs plateforme (public.users.is_platform_admin). */
export function SuperAdminRoute() {
  const { session, profile, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/login" replace />;
  if (!profile?.is_platform_admin) return <Navigate to="/" replace />;

  return <Outlet />;
}
