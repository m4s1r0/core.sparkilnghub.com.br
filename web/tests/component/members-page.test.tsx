import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorBody, fullSession, json, renderApp, stubFetch } from "./support";

afterEach(() => vi.unstubAllGlobals());

const INSTANCE = "0192f600-0000-7000-8000-00000000000a";
const instances = {
  items: [
    {
      id: INSTANCE,
      productCode: "sparkref",
      slug: "ref-a",
      displayName: "[SINTÉTICO] Instância A",
      synthetic: true,
    },
  ],
};
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
  it("lista instâncias com link para os vínculos", async () => {
    stubFetch(({ url }) =>
      url.endsWith("/api/v1/instances") ? json(instances) : json(fullSession),
    );
    renderApp("/instancias");
    expect(await screen.findByRole("link", { name: "[SINTÉTICO] Instância A" })).toHaveAttribute(
      "href",
      `/instancias/${INSTANCE}/vinculos`,
    );
    expect(screen.getByText("Sintética")).toBeInTheDocument();
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
      if (url.endsWith("/api/v1/instances")) return json(instances);
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
      if (url.endsWith("/api/v1/instances")) return json(instances);
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
