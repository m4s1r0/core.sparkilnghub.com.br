import { Button } from "@sparkling-hub/design-system";
import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { authApi, useRefreshSession } from "../api/auth";
import { Brand } from "./Brand";

const HEADER = "border-b border-[var(--color-sh-line)] bg-[var(--color-sh-surface)]";

/** Telas públicas (entrar, segundo fator, convite, recuperação): cartão central estreito. */
export function PublicLayout({ children }: { children?: ReactNode }) {
  return (
    <>
      <header className={HEADER}>
        <div className="mx-auto flex w-full max-w-5xl items-center px-4 py-3 sm:px-6">
          <Brand />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8 sm:px-6">
        {children ?? <Outlet />}
      </main>
    </>
  );
}

const NAV = [
  { to: "/", label: "Situação", end: true },
  { to: "/administradores", label: "Administradores" },
  { to: "/contas", label: "Contas" },
  { to: "/contratantes", label: "Contratantes" },
  { to: "/produtos", label: "Produtos" },
  { to: "/instancias", label: "Instâncias" },
  { to: "/pendencias", label: "Pendências" },
];

/**
 * Painel autenticado. Cabeçalho composto com Tailwind e links do roteador: o Navbar 0.2.0 navega
 * por href (recarrega a SPA) e exibe "Menu" sem itens (docs/design-system-updates.md).
 */
export function AppLayout() {
  const navigate = useNavigate();
  const refresh = useRefreshSession();
  const [leaving, setLeaving] = useState(false);
  const logout = async () => {
    setLeaving(true);
    try {
      await authApi.logout();
    } finally {
      await refresh();
      void navigate("/entrar", { replace: true });
    }
  };
  return (
    <>
      <header className={HEADER}>
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Brand />
          <nav aria-label="Painel" className="order-3 w-full sm:order-none sm:w-auto sm:flex-1">
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end ?? false}
                    className={({ isActive }) =>
                      `inline-flex min-h-11 items-center underline-offset-4 hover:underline ${
                        isActive ? "font-semibold underline" : ""
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <Button
            variant="ghost"
            className="ml-auto sm:ml-0"
            loading={leaving}
            onClick={() => void logout()}
          >
            Sair
          </Button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </>
  );
}
