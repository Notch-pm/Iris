import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { TenantProvider } from "@/features/tenant/TenantProvider";
import { AdminRoute, ProtectedRoute, SuperAdminRoute } from "@/components/layout/ProtectedRoute";
import { AppShell } from "@/components/layout/AppShell";
import { SuperAdminLayout } from "@/components/layout/SuperAdminLayout";
import { SuperAdminOrganisationsPage } from "@/features/superadmin/SuperAdminOrganisationsPage";
import { SuperAdminUsersPage } from "@/features/superadmin/SuperAdminUsersPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { ForgotPasswordPage } from "@/features/auth/ForgotPasswordPage";
import { SetPasswordPage } from "@/features/auth/SetPasswordPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { RequestsListPage } from "@/features/requests/RequestsListPage";
import { CartePage } from "@/features/requests/carte/CartePage";
import { TableauPage } from "@/features/requests/tableau/TableauPage";
import { RequestDetailPage } from "@/features/requests/RequestDetailPage";
import { NewRequestPage } from "@/features/requests/creation/NewRequestPage";
import { PermissionsPage } from "@/features/permissions/PermissionsPage";
import { UsagerPage } from "@/features/contacts/UsagerPage";
import { UsagersListPage } from "@/features/contacts/UsagersListPage";
import { AccountPage } from "@/features/account/AccountPage";
import { ApiDocsPage } from "@/features/public-api-docs/ApiDocsPage";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Routes publiques (hors shell) */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
          <Route path="/activer-compte" element={<SetPasswordPage mode="invite" />} />
          <Route path="/nouveau-mot-de-passe" element={<SetPasswordPage mode="recovery" />} />
          {/* Contrat d'ingestion, lisible sans compte (motif /api-doc du Socle) */}
          <Route path="/api-doc" element={<ApiDocsPage />} />

          {/* Zone superadmin — admins plateforme uniquement (shell séparé) */}
          <Route element={<SuperAdminRoute />}>
            <Route element={<SuperAdminLayout />}>
              <Route path="superadmin" index element={<SuperAdminOrganisationsPage />} />
              <Route path="superadmin/utilisateurs" element={<SuperAdminUsersPage />} />
            </Route>
          </Route>

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
              <Route path="demandes/tableau" element={<TableauPage />} />
              <Route path="carte" element={<CartePage />} />
              <Route path="demandes/nouvelle" element={<NewRequestPage />} />
              <Route path="demandes/:id" element={<RequestDetailPage />} />
              <Route path="usagers" element={<UsagersListPage />} />
              <Route path="usagers/:contactId" element={<UsagerPage />} />
              <Route path="mon-compte" element={<AccountPage />} />
              <Route element={<AdminRoute />}>
                <Route path="parametres">
                  <Route index element={<PermissionsPage />} />
                  {/* Ancienne adresse de la zone Droits (liens et signets existants). */}
                  <Route path="droits" element={<Navigate to="/parametres" replace />} />
                </Route>
              </Route>
            </Route>
          </Route>

          {/* Catch-all : dette assumée chez Socle, pas répliquée ici */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
