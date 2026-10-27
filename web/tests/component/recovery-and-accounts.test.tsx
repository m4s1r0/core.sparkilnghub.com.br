import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorBody, fullSession, json, renderApp, stubFetch } from "./support";

afterEach(() => vi.unstubAllGlobals());

const noSession = () => json(errorBody("AUTH_SESSION_REQUIRED", "Sessão encerrada."), 401);
const ACCOUNT = "0192f6b0-0000-7000-8000-0000000000c1";
const A = "0192f600-0000-7000-8000-00000000000a";
const B = "0192f600-0000-7000-8000-00000000000b";

const detail = (status: "ativa" | "bloqueada") => ({
  account: {
    accountId: ACCOUNT,
    displayName: "[SINTÉTICO] Carla",
    email: "carla@example.test",
    status,
  },
  mfaEnrolled: false,
  platformRole: null,
  memberships: [
    {
      membershipId: "m1",
      instanceId: A,
      instanceName: "[SINTÉTICO] Instância A",
      role: "colaborador",
      status: "ativo",
    },
    {
      membershipId: "m2",
      instanceId: B,
      instanceName: "[SINTÉTICO] Instância B",
      role: "colaborador",
      status: "ativo",
    },
  ],
  pendingRecoveryRequests: 1,
});

describe("RecoveryRequestPage e PasswordResetPage (públicas)", () => {
  it("pedido de recuperação: mensagem neutra depois do envio", async () => {
    const calls = stubFetch(({ url }) =>
      url.endsWith("/recovery-requests") ? json({ message: "ok" }, 202) : noSession(),
    );
    renderApp("/recuperar");
    await userEvent.type(await screen.findByLabelText(/E-mail/), "qualquer@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Pedir recuperação" }));
    expect(await screen.findByText(/Se houver conta com este e-mail/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/recovery-requests"))?.body).toEqual({
      email: "qualquer@example.test",
    });
  });

  it("link inválido: aviso e caminho para pedir de novo", async () => {
    stubFetch(({ url }) =>
      url.includes("/password-resets/")
        ? json(errorBody("RESET_INVALID", "Link inválido."), 404)
        : noSession(),
    );
    renderApp("/recuperar/abc");
    await userEvent.type(await screen.findByLabelText(/^Nova senha/), "nova senha longa ok");
    await userEvent.type(screen.getByLabelText(/Repita a nova senha/), "nova senha longa ok");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(await screen.findByText("Link inválido ou expirado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pedir de novo" })).toHaveAttribute(
      "href",
      "/recuperar",
    );
  });

  it("senha trocada: avisa que todas as sessões foram encerradas", async () => {
    stubFetch(({ url }) =>
      url.includes("/password-resets/")
        ? json({ instances: [{ instanceId: A, status: "aplicada" }] })
        : noSession(),
    );
    renderApp("/recuperar/abc");
    await userEvent.type(await screen.findByLabelText(/^Nova senha/), "nova senha longa ok");
    await userEvent.type(screen.getByLabelText(/Repita a nova senha/), "nova senha longa ok");
    await userEvent.click(screen.getByRole("button", { name: "Salvar nova senha" }));
    expect(
      await screen.findByText(/todas as sessões abertas foram encerradas/),
    ).toBeInTheDocument();
  });
});

describe("AccountsPage, AccountPage e PendingPage", () => {
  it("busca é exata e a fila mostra pedidos pendentes", async () => {
    stubFetch(({ url }) => {
      if (url.endsWith("/recovery-requests"))
        return json({
          items: [
            {
              id: "r1",
              email: "carla@example.test",
              accountId: ACCOUNT,
              createdAt: "2026-10-26T12:00:00.000Z",
            },
          ],
        });
      if (url.includes("/api/v1/accounts?email="))
        return json({ items: [detail("ativa").account] });
      return json(fullSession);
    });
    renderApp("/contas");
    expect(await screen.findByRole("link", { name: "Abrir conta" })).toHaveAttribute(
      "href",
      `/contas/${ACCOUNT}`,
    );
    await userEvent.type(screen.getByLabelText(/E-mail/), "carla@");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getByText(/a busca é exata/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/E-mail/), "example.test");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByRole("link", { name: "[SINTÉTICO] Carla" })).toBeInTheDocument();
  });

  it("bloqueio mostra as instâncias afetadas e avisa quando uma ficou pendente", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.endsWith("/block-preview"))
        return json({
          instances: [
            { instanceId: A, name: "[SINTÉTICO] Instância A", role: "colaborador" },
            { instanceId: B, name: "[SINTÉTICO] Instância B", role: "colaborador" },
          ],
        });
      if (url.endsWith("/block"))
        return json({
          instances: [
            { instanceId: A, status: "aplicada" },
            { instanceId: B, status: "pendente" },
          ],
        });
      if (url.endsWith(`/accounts/${ACCOUNT}`)) return json(detail("ativa"));
      return json(fullSession);
    });
    renderApp(`/contas/${ACCOUNT}`);
    await userEvent.click(await screen.findByRole("button", { name: "Bloquear conta" }));
    const dialog = await screen.findByRole("dialog", { name: "Bloquear [SINTÉTICO] Carla" });
    const affected = within(dialog).getByRole("list", { name: "Instâncias afetadas" });
    expect(within(affected).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), "incidente de segurança");
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Bloquear [SINTÉTICO] Carla em todas as instâncias",
      }),
    );
    expect(await screen.findByText("Aplicação pendente")).toBeInTheDocument();
    const block = calls.find((c) => c.url.endsWith("/block"));
    expect(block?.headers.get("idempotency-key")).toBeTruthy();
  });

  it("conta bloqueada oferece desbloquear", async () => {
    stubFetch(({ url }) =>
      url.endsWith(`/accounts/${ACCOUNT}`) ? json(detail("bloqueada")) : json(fullSession),
    );
    renderApp(`/contas/${ACCOUNT}`);
    expect(await screen.findByRole("button", { name: "Desbloquear" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bloquear conta" })).not.toBeInTheDocument();
  });

  it("pendências: estado vazio", async () => {
    stubFetch(({ url }) =>
      url.endsWith("/access-sync/pending") ? json({ items: [] }) : json(fullSession),
    );
    renderApp("/pendencias");
    expect(await screen.findByText(/Nenhuma pendência/)).toBeInTheDocument();
  });
});
