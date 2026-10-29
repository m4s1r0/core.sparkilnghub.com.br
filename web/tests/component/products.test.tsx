import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fullSession, json, renderApp, stubFetch } from "./support";

afterEach(() => vi.unstubAllGlobals());

const product = (patch: Record<string, unknown> = {}) => ({
  code: "sparkpet",
  name: "Tuteli",
  description: "Pet shops",
  status: "ativo",
  provisioner: null,
  deployedVersion: null,
  supportedSchemaVersion: null,
  provisionable: false,
  notProvisionableReason: "SEM_PROVISIONADOR",
  version: 1,
  ...patch,
});

describe("ProductsPage (/produtos)", () => {
  it("mostra provisionável ou o motivo, sem campo de SQL, script ou URL", async () => {
    stubFetch(({ url }) =>
      url.endsWith("/api/v1/products")
        ? json({
            items: [
              product(),
              product({
                code: "sparkref",
                name: "Referência",
                provisioner: "sparkref-v1",
                deployedVersion: 2,
                supportedSchemaVersion: 2,
                provisionable: true,
                notProvisionableReason: null,
              }),
            ],
          })
        : json(fullSession),
    );
    renderApp("/produtos");
    expect(await screen.findByText("v2")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(
      within(table).getByText(/ainda não publicou seu artefato de migração/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("ProductPage (/produtos/:code)", () => {
  it("edita só nome e descrição; código e versões são somente leitura", async () => {
    const calls = stubFetch(({ url, method }) => {
      if (url.endsWith("/products/sparkpet") && method === "PUT")
        return json(product({ version: 2 }));
      if (url.endsWith("/products/sparkpet")) return json(product());
      return json(fullSession);
    });
    renderApp("/produtos/sparkpet");
    expect(await screen.findByText("Por que não é provisionável")).toBeInTheDocument();
    const textboxes = screen.getAllByRole("textbox").map((el) => el.getAttribute("name"));
    expect(textboxes.sort()).toEqual(["description", "name"]);
    await userEvent.clear(screen.getByLabelText(/Nome/));
    await userEvent.type(screen.getByLabelText(/Nome/), "Tuteli Pro");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Alterações salvas.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      name: "Tuteli Pro",
      description: "Pet shops",
      version: 1,
    });
  });

  it("inativar pede motivo e avisa que instâncias existentes não mudam", async () => {
    stubFetch(({ url, method }) => {
      if (url.endsWith("/inactivate") && method === "POST") {
        return json(
          product({ status: "inativo", notProvisionableReason: "PRODUTO_INATIVO", version: 2 }),
        );
      }
      if (url.endsWith("/products/sparkpet")) return json(product());
      return json(fullSession);
    });
    renderApp("/produtos/sparkpet");
    await userEvent.click(await screen.findByRole("button", { name: "Inativar" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/instâncias existentes não mudam/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), "fim de oferta");
    await userEvent.click(within(dialog).getByRole("button", { name: "Inativar Tuteli" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
