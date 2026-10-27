import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fullSession, json, renderApp, stubFetch, task } from "./support";

afterEach(() => vi.unstubAllGlobals());

const INSTANCE = "0192f6b0-0000-7000-8000-0000000000bb";

const detail = (status: string) => ({
  id: INSTANCE,
  contractorId: "0192f6b0-0000-7000-8000-0000000000aa",
  contractorName: "Pet Feliz",
  productCode: "sparkref",
  slug: "loja-centro",
  displayName: "Loja Centro",
  state: "PRONTA",
  synthetic: true,
  lastTask: { protocol: "PRV-000042", status: "concluida" },
  validityExpired: false,
  createdAt: "2026-10-27T12:00:00.000Z",
  timezone: "America/Sao_Paulo",
  initialAdminEmail: "dona@example.test",
  schemaVersion: 2,
  notes: null,
  validFrom: null,
  validUntil: null,
  version: 1,
  initialInvitation: { status, expiresAt: null },
  transitions: [],
});

describe("ProvisioningPage — convite inicial (US5)", () => {
  it("aguardando emissão → emitir mostra o link uma vez; situação separada da prontidão", async () => {
    let issued = false;
    const calls = stubFetch(({ url, method }) => {
      if (url.endsWith("/initial-invitation/issue") && method === "POST") {
        issued = true;
        return json(
          { link: "http://127.0.0.1:3000/convite/abc", expiresAt: "2026-10-29T12:00:00.000Z" },
          201,
        );
      }
      if (url.includes("/provisioning")) {
        return json(task({ status: "concluida", instanceState: "PRONTA", currentStep: null }));
      }
      if (url.endsWith(`/instances/${INSTANCE}`)) {
        return json(detail(issued ? "emitido" : "aguardando_emissao"));
      }
      return json(fullSession);
    });
    renderApp(`/instancias/${INSTANCE}/provisionamento`);
    expect(await screen.findByText("Aguardando emissão do link")).toBeInTheDocument();
    expect(screen.getByText("Instância pronta")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Emitir link" }));
    expect(
      await screen.findByDisplayValue("http://127.0.0.1:3000/convite/abc"),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/não poderá ser consultado/i)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith("/issue"))?.headers.get("idempotency-key")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("aceito: sem botão de emissão", async () => {
    stubFetch(({ url }) => {
      if (url.includes("/provisioning")) {
        return json(task({ status: "concluida", instanceState: "PRONTA", currentStep: null }));
      }
      if (url.endsWith(`/instances/${INSTANCE}`)) return json(detail("aceito"));
      return json(fullSession);
    });
    renderApp(`/instancias/${INSTANCE}/provisionamento`);
    expect(await screen.findByText("Aceito")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Emitir link|Reemitir link/ })).toBeNull();
  });
});
