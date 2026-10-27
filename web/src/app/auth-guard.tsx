import { Alert, Button, Skeleton } from "@sparkling-hub/design-system";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { ApiError } from "../api/client";
import { useSession } from "../api/auth";

/**
 * Guarda de rota: a interface só decide navegação; autorização é sempre do servidor (DS
 * AGENTS.md §6). Sem sessão → /entrar (guarda o destino). `mfa` exige o segundo fator: sem ele,
 * vai para o código ou para o cadastro do TOTP.
 */
export function RequireSession({ children, mfa = true }: { children: ReactNode; mfa?: boolean }) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-8" aria-busy="true">
        <Skeleton label="Verificando sessão" lines={3} />
      </div>
    );
  }
  if (session.isError) {
    const error = session.error instanceof ApiError ? session.error : null;
    return (
      <div className="mx-auto w-full max-w-md px-4 py-8">
        <Alert tone="error" title="Não foi possível verificar sua sessão">
          <div className="flex flex-col items-start gap-3">
            <span>{error?.message ?? "Ocorreu uma falha inesperada."}</span>
            {error?.correlationId && <span>Correlação: {error.correlationId}</span>}
            <Button variant="secondary" onClick={() => void session.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Alert>
      </div>
    );
  }
  const info = session.data;
  if (!info) {
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }
  if (mfa && !info.mfa.confirmed) {
    return (
      <Navigate
        to={info.mfa.enrolled ? "/entrar/segundo-fator" : "/conta/seguranca/totp"}
        replace
        state={{ from: location.pathname }}
      />
    );
  }
  return <>{children}</>;
}

/** Destino guardado pela guarda, ou a página inicial. */
export function returnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
}
