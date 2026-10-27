import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorBody, fullSession, json, renderApp, stubFetch } from "./support";

afterEach(() => vi.unstubAllGlobals());

const INSTANCE = "0192f6b0-0000-7000-8000-0000000000bb";
const summary = {
  id: INSTANCE,
  contractorId: "0192f6b0-0000-7000-8000-0000000000aa",
  contractorName: "Pet Feliz",
  productCode: "sparkref",
  slug: "loja-centro",
  displayName: "Loja Centro",
  state: "PRONTA",
  synthetic: false,
  lastTask: { protocol: "PRV-000042", status: "concluida" },
  validityExpired: true,
  createdAt: "2026-10-27T12:00:00.000Z",
};
const detail = {
  ...summary,
  timezone: "America/Sao_Paulo",
  initialAdminEmail: "dona@example.test",
  schemaVersion: 2,
  notes: "Contrato assinado.",
  validFrom: "2026-01-01",
  validUntil: "2026-10-01",
  version: 3,
  initialInvitation: { status: "aguardando_emissao", expiresAt: null },
  transitions: [
    {
      from: null,
      to: "CADASTRADA",
      actorKind: "usuario",
      actorName: "Ana",
      reason: "solicitacao",
      at: "2026-10-27T12:00:00.000Z",
    },
    {
      from: "PROVISIONANDO",
      to: "PRONTA",
      actorKind: "sistema",
      actorName: "Sistema",
      reason: null,
      at: "2026-10-27T12:00:05.000Z",
    },
  ],
};

describe("InstancesPage (/instancias)", () => {
  it("filtros na URL e na consulta; estado, vigência vencida e protocolo na lista", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.includes("/api/v1/instances?")) {
        return json({ items: [summary], pageInfo: { page: 1, pageSize: 20, total: 1 } });
      }
      if (url.includes("/api/v1/contractors")) {
        return json({ items: [], pageInfo: { page: 1, pageSize: 20, total: 0 } });
      }
      if (url.endsWith("/api/v1/products")) return json({ items: [] });
      return json(fullSession);
    });
    const { router } = renderApp("/instancias");
    expect(await screen.findByRole("link", { name: "PRV-000042" })).toBeInTheDocument();
    expect(screen.getByText("Vigência vencida")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Estado"), "PRONTA");
    await waitFor(() => expect(router.state.location.search).toBe("?state=PRONTA"));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/api/v1/instances?") && c.url.includes("state=PRONTA")),
      ).toBe(true),
    );
  });
});

describe("InstancePage (/instancias/:id)", () => {
  it("slug sem edição, pendência de vigência e linha do tempo", async () => {
    stubFetch(({ url }) =>
      url.endsWith(`/instances/${INSTANCE}`) ? json(detail) : json(fullSession),
    );
    renderApp(`/instancias/${INSTANCE}`);
    expect(await screen.findByRole("heading", { name: "Loja Centro" })).toBeInTheDocument();
    expect(screen.getByText("Vigência vencida")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Identificador/ })).toBeNull();
    expect(screen.getByText("(não pode ser alterado)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Linha do tempo" }));
    expect(await screen.findByText("Provisionando → Pronta")).toBeInTheDocument();
    expect(screen.getByText(/Sistema/)).toBeInTheDocument();
  });

  it("conflito de versão mantém o texto digitado", async () => {
    stubFetch(({ url, method }) => {
      if (url.endsWith(`/instances/${INSTANCE}`) && method === "PUT") {
        return json(errorBody("CONFLICT_VERSION", "Alterada por outra pessoa."), 409);
      }
      if (url.endsWith(`/instances/${INSTANCE}`)) return json(detail);
      return json(fullSession);
    });
    renderApp(`/instancias/${INSTANCE}`);
    const name = await screen.findByLabelText(/Nome de exibição/);
    await userEvent.clear(name);
    await userEvent.type(name, "Loja Centro Nova");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Outra pessoa alterou a instância/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome de exibição/)).toHaveValue("Loja Centro Nova");
  });
});
