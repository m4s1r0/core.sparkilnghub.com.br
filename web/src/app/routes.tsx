import { Alert, Heading } from "@sparkling-hub/design-system";
import { Link, type RouteObject } from "react-router";
import { AccountPage } from "../pages/accounts/AccountPage";
import { AccountsPage } from "../pages/accounts/AccountsPage";
import { AdminsPage } from "../pages/admins/AdminsPage";
import { InstancesPage } from "../pages/instances/InstancesPage";
import { MembersPage } from "../pages/instances/MembersPage";
import { InvitationPage } from "../pages/invitation/InvitationPage";
import { LoginPage } from "../pages/login/LoginPage";
import { MfaPage } from "../pages/mfa/MfaPage";
import { PendingPage } from "../pages/pending/PendingPage";
import { PasswordResetPage } from "../pages/recovery/PasswordResetPage";
import { RecoveryRequestPage } from "../pages/recovery/RecoveryRequestPage";
import { TotpEnrollmentPage } from "../pages/security/TotpEnrollmentPage";
import { SystemStatusPage } from "../pages/system-status/SystemStatusPage";
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

/** Rotas do painel (contracts/ui-f01.md). Autorização é sempre do servidor. */
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
      { path: "/", element: <SystemStatusPage /> },
      { path: "/administradores", element: <AdminsPage /> },
      { path: "/instancias", element: <InstancesPage /> },
      { path: "/instancias/:id/vinculos", element: <MembersPage /> },
      { path: "/contas", element: <AccountsPage /> },
      { path: "/contas/:id", element: <AccountPage /> },
      { path: "/pendencias", element: <PendingPage /> },
    ],
  },
  {
    element: <PublicLayout />,
    children: [{ path: "*", element: <NotFoundPage /> }],
  },
];
