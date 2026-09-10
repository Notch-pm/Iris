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
import { MesInterventionsPage } from "@/features/requests/interventions/MesInterventionsPage";
import { NewRequestPage } from "@/features/requests/creation/NewRequestPage";
import { PermissionsPage } from "@/features/permissions/PermissionsPage";
import { UsagerPage } from "@/features/contacts/UsagerPage";
import { UsagersListPage } from "@/features/contacts/UsagersListPage";
import { AccountPage } from "@/features/account/AccountPage";
import { ApiDocsPage } from "@/features/public-api-docs/ApiDocsPage";
import { DeviceProvider } from "@/features/device/DeviceProvider";
import { Adaptive } from "@/features/device/Adaptive";
import { MobileHome } from "@/features/device/MobileHome";
import { MobileShell } from "@/components/layout/mobile/MobileShell";
import { MobileRequestsListPage } from "@/features/requests/mobile/MobileRequestsListPage";
import { MobileRequestPage } from "@/features/requests/mobile/MobileRequestPage";
import { MobileNewRequestPage } from "@/features/requests/creation/mobile/MobileNewRequestPage";
import { MobileInterventionsPage } from "@/features/requests/interventions/mobile/MobileInterventionsPage";

export function App() {
  return (
    <BrowserRouter>
      {/* Appareil (téléphone ou bureau) connu dès la racine : les routes
          publiques pourront s'en servir, et `Adaptive` choisit le rendu. */}
      <DeviceProvider>
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

          {/* Zone authentifiée — tenant sélectionné dans le shell.
              MÊME URL, DEUX RENDUS (2026-09-14) : sur téléphone, `Adaptive` rend
              le shell mobile et, route par route, la page mobile quand elle
              existe — sinon l'écran d'orientation vers la version bureau. Le
              permalien d'un e-mail ouvre donc la bonne fiche sur les deux. */}
          <Route element={<ProtectedRoute />}>
            <Route
              element={
                <TenantProvider>
                  <Adaptive desktop={<AppShell />} mobile={<MobileShell />} />
                </TenantProvider>
              }
            >
              <Route index element={<Adaptive desktop={<DashboardPage />} mobile={<MobileHome />} />} />
              <Route path="demandes" element={<Adaptive desktop={<RequestsListPage />} mobile={<MobileRequestsListPage />} />} />
              <Route path="demandes/tableau" element={<Adaptive desktop={<TableauPage />} />} />
              <Route path="carte" element={<Adaptive desktop={<CartePage />} />} />
              <Route path="demandes/nouvelle" element={<Adaptive desktop={<NewRequestPage />} mobile={<MobileNewRequestPage />} />} />
              <Route path="demandes/:id" element={<Adaptive desktop={<RequestDetailPage />} mobile={<MobileRequestPage />} />} />
              <Route path="interventions" element={<Adaptive desktop={<MesInterventionsPage />} mobile={<MobileInterventionsPage />} />} />
              <Route path="usagers" element={<Adaptive desktop={<UsagersListPage />} />} />
              <Route path="usagers/:contactId" element={<Adaptive desktop={<UsagerPage />} />} />
              {/* Colonne unique, lisible telle quelle sur un téléphone. */}
              <Route path="mon-compte" element={<AccountPage />} />
              <Route element={<AdminRoute />}>
                <Route path="parametres">
                  <Route index element={<Adaptive desktop={<PermissionsPage />} />} />
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
      </DeviceProvider>
    </BrowserRouter>
  );
}
