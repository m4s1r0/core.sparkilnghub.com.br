import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorBody, fullSession, json, renderApp, stubFetch } from "./support";

afterEach(() => vi.unstubAllGlobals());

const INSTANCE = "0192f600-0000-7000-8000-00000000000a";
const summary = {
  id: INSTANCE,
  contractorId: "0192f600-0000-7000-8000-0000000000c1",
  contractorName: "[SINTÉTICO] Contratante de referência",
  productCode: "sparkref",
  slug: "ref-a",
  displayName: "[SINTÉTICO] Instância A",
  state: "ATIVA",
  synthetic: true,
  lastTask: null,
  validityExpired: false,
  createdAt: "2026-10-26T12:00:00.000Z",
};
// Desde F02 a lista é paginada e o detalhe tem endpoint próprio (MembersPage usa o detalhe).
const instances = { items: [summary], pageInfo: { page: 1, pageSize: 20, total: 1 } };
const detail = {
  ...summary,
  timezone: "America/Sao_Paulo",
  initialAdminEmail: "",
  schemaVersion: 2,
  notes: null,
  validFrom: null,
  validUntil: null,
  version: 1,
  initialInvitation: { status: "inexistente", expiresAt: null },
  transitions: [],
};
const instanceStub = (url: string) =>
  url.includes("/api/v1/instances?")
    ? json(instances)
    : url.endsWith(`/api/v1/instances/${INSTANCE}`)
      ? json(detail)
      : null;
const carla = {
  membershipId: "0192f6b0-0000-7000-8000-0000000000c1",
  invitationId: null,
  displayName: "[SINTÉTICO] Carla",
  emailMasked: "c***@example.test",
  role: "colaborador",
  status: "ativo",
  version: 1,
};
const pending = {
  membershipId: null,
  invitationId: "0192f6b0-0000-7000-8000-0000000000d1",
  displayName: null,
  emailMasked: "d***@example.test",
  role: "colaborador",
  status: "convite_pendente",
  version: null,
};

async function openActions(name: string) {
  const trigger = await screen.findByRole("button", { name: `Ações para ${name}` });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
}

describe("InstancesPage e MembersPage (US4)", () => {
  it("lista instâncias com link para o detalhe, de onde se chega aos vínculos", async () => {
    stubFetch(({ url }) => instanceStub(url) ?? json(fullSession));
    renderApp("/instancias");
    expect(await screen.findByRole("link", { name: "[SINTÉTICO] Instância A" })).toHaveAttribute(
      "href",
      `/instancias/${INSTANCE}`,
    );
    expect(within(screen.getByRole("table")).getByText("Ativa")).toBeInTheDocument();
  });

  it("vínculos e convites pendentes; conflito de versão mantém o motivo digitado", async () => {
    let roleCalls = 0;
    stubFetch(({ url }) => {
      if (url.endsWith("/role")) {
        roleCalls += 1;
        return json(
          errorBody("CONFLICT_VERSION", "O registro foi alterado por outra pessoa."),
          409,
        );
      }
      if (url.endsWith("/members")) return json({ items: [carla, pending] });
      const instance = instanceStub(url);
      if (instance) return instance;
      return json(fullSession);
    });
    renderApp(`/instancias/${INSTANCE}/vinculos`);
    expect(
      await screen.findByRole("heading", { name: "Vínculos de [SINTÉTICO] Instância A" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("[SINTÉTICO] Carla")).toBeInTheDocument();
    expect(screen.getByText("Convite pendente")).toBeInTheDocument();

    await openActions("[SINTÉTICO] Carla");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mudar papel" }));
    const dialog = await screen.findByRole("dialog", { name: "Mudar papel de [SINTÉTICO] Carla" });
    expect(within(dialog).getByLabelText(/Novo papel/)).toHaveValue("administrador");
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), "promoção a gerente");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Mudar papel de [SINTÉTICO] Carla" }),
    );
    expect(
      await within(dialog).findByText("O registro foi alterado por outra pessoa."),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Motivo/)).toHaveValue("promoção a gerente");
    expect(roleCalls).toBe(1);
  });

  it("revogação com instância inacessível avisa que ficou pendente", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.endsWith("/revoke"))
        return json({ instances: [{ instanceId: INSTANCE, status: "pendente" }] });
      if (url.endsWith("/members")) return json({ items: [carla] });
      const instance = instanceStub(url);
      if (instance) return instance;
      return json(fullSession);
    });
    renderApp(`/instancias/${INSTANCE}/vinculos`);
    await openActions("[SINTÉTICO] Carla");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Revogar acesso" }));
    const dialog = await screen.findByRole("dialog", { name: "Revogar acesso" });
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), "saiu do estabelecimento");
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Revogar acesso de [SINTÉTICO] Carla à [SINTÉTICO] Instância A",
      }),
    );
    expect(await screen.findByText("Aplicação pendente")).toBeInTheDocument();
    const revoke = calls.find((c) => c.url.endsWith("/revoke"));
    expect(revoke?.body).toEqual({ reason: "saiu do estabelecimento", version: 1 });
    expect(revoke?.headers.get("idempotency-key")).toBeTruthy();
  });
});
