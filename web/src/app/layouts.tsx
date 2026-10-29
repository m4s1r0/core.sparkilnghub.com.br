import { useState, type ReactNode } from "react";
import {
  Activity,
  BarChart2,
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  LogOut,
  Package,
  Server,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
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
  { to: "/", label: "Situação", end: true, Icon: Activity },
  { to: "/administradores", label: "Administradores", Icon: Users },
  { to: "/contas", label: "Contas", Icon: User },
  { to: "/contratantes", label: "Contratantes", Icon: Building2 },
  { to: "/produtos", label: "Produtos", Icon: Package },
  { to: "/instancias", label: "Instâncias", Icon: Server },
  { to: "/pendencias", label: "Pendências", Icon: Clock },
  { to: "/acessos", label: "Acessos", Icon: ShieldCheck },
  { to: "/auditoria", label: "Auditoria", Icon: BookOpen },
  { to: "/utilizacao", label: "Utilização", Icon: BarChart2 },
];

const ITEM_BASE =
  "flex w-full items-center gap-3 rounded-lg px-3 min-h-11 text-sm transition-colors duration-150";
const ITEM_IDLE = "text-white/70 hover:bg-white/10 hover:text-white";
const ITEM_ACTIVE = "bg-white/15 text-white font-semibold";

/** Painel autenticado com menu lateral colapsável. */
export function AppLayout() {
  const navigate = useNavigate();
  const refresh = useRefreshSession();
  const [leaving, setLeaving] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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
    <div className="flex h-dvh overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`flex flex-col bg-[var(--color-sh-dark-surface)] border-r border-[var(--color-sh-dark-line)] transition-[width] duration-[220ms] ease-[cubic-bezier(.16,1,.3,1)] overflow-hidden shrink-0 ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        {/* Brand */}
        <div
          className={`flex h-16 shrink-0 items-center border-b border-[var(--color-sh-dark-line)] ${
            collapsed ? "justify-center px-0" : "px-4"
          }`}
        >
          {collapsed ? (
            <img src="/brand/monograma-branco.svg" alt="Sparkling Hub" className="h-9 w-auto" />
          ) : (
            <span className="flex w-full items-center gap-2">
              <img
                src="/brand/sparkling-hub-branco.svg"
                alt="Sparkling Hub"
                className="w-3/5 h-auto object-contain shrink-0"
              />
              <span className="flex-1 min-w-0 truncate font-semibold text-white text-sm">
                SparkCore
              </span>
            </span>
          )}
        </div>

        {/* Nav items */}
        <nav aria-label="Painel" className="flex-1 overflow-y-auto py-3">
          <ul className="flex flex-col gap-0.5 px-2">
            {NAV.map(({ to, label, end, Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end ?? false}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    `${ITEM_BASE} ${isActive ? ITEM_ACTIVE : ITEM_IDLE} ${collapsed ? "justify-center" : ""}`
                  }
                >
                  <Icon size={18} className="shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Footer: sair + colapsar */}
        <div className="shrink-0 border-t border-[var(--color-sh-dark-line)] p-2 flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => void logout()}
            disabled={leaving}
            title="Sair"
            className={`${ITEM_BASE} ${ITEM_IDLE} disabled:opacity-50 ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && <span>Sair</span>}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className={`${ITEM_BASE} text-white/70 hover:bg-white/10 hover:text-white ${
              collapsed ? "justify-center" : "justify-between"
            }`}
          >
            {!collapsed && <span className="text-xs">Recolher</span>}
            {collapsed ? (
              <ChevronRight size={16} className="shrink-0" />
            ) : (
              <ChevronLeft size={16} className="shrink-0" />
            )}
          </button>
        </div>
      </aside>

      {/* Área de conteúdo */}
      <div className="flex-1 overflow-y-auto bg-[var(--color-sh-ground)]">
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
