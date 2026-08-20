import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { TenantProvider } from "@/features/tenant/TenantProvider";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { LoginPage } from "@/features/auth/LoginPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RequestsListPage } from "@/features/requests/RequestsListPage";
import { RequestDetailPage } from "@/features/requests/RequestDetailPage";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Routes publiques (hors shell) */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />

          {/* Zone authentifiée — tenant sélectionné dans le shell */}
          <Route element={<ProtectedRoute />}>
            <Route
              element={
                <TenantProvider>
                  <AppShell />
                </TenantProvider>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="demandes" element={<RequestsListPage />} />
              <Route path="demandes/:id" element={<RequestDetailPage />} />
            </Route>
          </Route>

          {/* Catch-all : dette assumée chez Socle, pas répliquée ici */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
