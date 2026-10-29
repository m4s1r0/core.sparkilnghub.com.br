import { Alert, Heading } from "@sparkling-hub/design-system";
import { Link, type RouteObject } from "react-router";
import { AccountPage } from "../pages/accounts/AccountPage";
import { AccountsPage } from "../pages/accounts/AccountsPage";
import { AdminsPage } from "../pages/admins/AdminsPage";
import { ContractorFormPage } from "../pages/contractors/ContractorFormPage";
import { ContractorPage } from "../pages/contractors/ContractorPage";
import { ContractorsPage } from "../pages/contractors/ContractorsPage";
import { DashboardPage } from "../pages/dashboard/DashboardPage";
import { InstancePage } from "../pages/instances/InstancePage";
import { InstancesPage } from "../pages/instances/InstancesPage";
import { MembersPage } from "../pages/instances/MembersPage";
import { NewInstancePage } from "../pages/instances/NewInstancePage";
import { ProvisioningPage } from "../pages/instances/ProvisioningPage";
import { InvitationPage } from "../pages/invitation/InvitationPage";
import { LoginPage } from "../pages/login/LoginPage";
import { MfaPage } from "../pages/mfa/MfaPage";
import { PendingPage } from "../pages/pending/PendingPage";
import { ProductPage } from "../pages/products/ProductPage";
import { ProductsPage } from "../pages/products/ProductsPage";
import { PasswordResetPage } from "../pages/recovery/PasswordResetPage";
import { RecoveryRequestPage } from "../pages/recovery/RecoveryRequestPage";
import { TotpEnrollmentPage } from "../pages/security/TotpEnrollmentPage";
import { AuditEventsPage } from "../pages/audit/AuditEventsPage";
import { SecurityEventsPage } from "../pages/security-events/SecurityEventsPage";
import { UsagePage } from "../pages/usage/UsagePage";
import { RequireSession } from "./auth-guard";
import { AppLayout, PublicLayout } from "./layouts";

function NotFoundPage() {
  return (
    <>
      <Heading level={1}>Página não encontrada</Heading>
      <Alert tone="info" title="Endereço inexistente">
        <Link to="/" className="underline underline-offset-4">
          Voltar ao painel
        </Link>
      </Alert>
    </>
  );
}

/** Rotas do painel (contracts/ui-f01.md, ui-f02.md). Autorização é sempre do servidor. */
export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: "/entrar", element: <LoginPage /> },
      {
        path: "/entrar/segundo-fator",
        element: (
          <RequireSession mfa={false}>
            <MfaPage />
          </RequireSession>
        ),
      },
      { path: "/convite/:token", element: <InvitationPage /> },
      { path: "/recuperar", element: <RecoveryRequestPage /> },
      { path: "/recuperar/:token", element: <PasswordResetPage /> },
      {
        path: "/conta/seguranca/totp",
        element: (
          <RequireSession mfa={false}>
            <TotpEnrollmentPage />
          </RequireSession>
        ),
      },
    ],
  },
  {
    element: (
      <RequireSession>
        <AppLayout />
      </RequireSession>
    ),
    children: [
      { path: "/", element: <DashboardPage /> },
      { path: "/administradores", element: <AdminsPage /> },
      { path: "/contratantes", element: <ContractorsPage /> },
      { path: "/contratantes/novo", element: <ContractorFormPage /> },
      { path: "/contratantes/:id", element: <ContractorPage /> },
      { path: "/contratantes/:id/editar", element: <ContractorFormPage /> },
      { path: "/produtos", element: <ProductsPage /> },
      { path: "/produtos/:code", element: <ProductPage /> },
      { path: "/instancias", element: <InstancesPage /> },
      { path: "/instancias/nova", element: <NewInstancePage /> },
      { path: "/instancias/:id", element: <InstancePage /> },
      { path: "/instancias/:id/provisionamento", element: <ProvisioningPage /> },
      { path: "/instancias/:id/vinculos", element: <MembersPage /> },
      { path: "/contas", element: <AccountsPage /> },
      { path: "/contas/:id", element: <AccountPage /> },
      { path: "/pendencias", element: <PendingPage /> },
      { path: "/acessos", element: <SecurityEventsPage /> },
      { path: "/auditoria", element: <AuditEventsPage /> },
      { path: "/utilizacao", element: <UsagePage /> },
    ],
  },
  {
    element: <PublicLayout />,
    children: [{ path: "*", element: <NotFoundPage /> }],
  },
];
