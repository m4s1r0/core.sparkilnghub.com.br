import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fullSession, json, renderApp, stubFetch, task } from "./support";

afterEach(() => vi.unstubAllGlobals());

const INSTANCE = "0192f6b0-0000-7000-8000-0000000000bb";

const failed = (code: string, retryable: boolean) =>
  task({
    status: "falhou",
    instanceState: "FALHA_PROVISIONAMENTO",
    currentStep: "criar_credencial",
    error: {
      code,
      message: "Mensagem segura da falha.",
      step: "criar_credencial",
      retryable,
    },
  });

describe("ProvisioningPage — falhas (US4)", () => {
  it("falha repetível: pede motivo e repete; a página volta a acompanhar", async () => {
    let retried = false;
    const calls = stubFetch(({ url, method }) => {
      if (url.endsWith("/provisioning/retry") && method === "POST") {
        retried = true;
        return json(task({ status: "pendente", runNumber: 2 }), 202);
      }
      if (url.includes("/provisioning")) {
        return json(
          retried
            ? task({ status: "pendente", runNumber: 2 })
            : failed("PROVISIONING_DEPENDENCY_UNAVAILABLE", true),
        );
      }
      return json(fullSession);
    });
    renderApp(`/instancias/${INSTANCE}/provisionamento`);
    expect(
      await screen.findByText("Falha no provisionamento", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Etapa Credencial: Mensagem segura da falha/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Repetir" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), "MySQL voltou");
    await userEvent.click(within(dialog).getByRole("button", { name: "Repetir provisionamento" }));
    expect(await screen.findByText(/Em andamento/)).toBeInTheDocument();
    const post = calls.find((c) => c.url.endsWith("/provisioning/retry"));
    expect(post?.body).toEqual({ reason: "MySQL voltou" });
    expect(post?.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("falha que exige procedimento: sem botão de repetir, com protocolo e orientação", async () => {
    stubFetch(({ url }) =>
      url.includes("/provisioning")
        ? json(failed("PROVISIONING_RESOURCE_CONFLICT", false))
        : json(fullSession),
    );
    renderApp(`/instancias/${INSTANCE}/provisionamento`);
    expect(await screen.findByText("Falha que exige procedimento operacional")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Repetir" })).toBeNull();
    expect(screen.getByText("PROVISIONING_RESOURCE_CONFLICT")).toBeInTheDocument();
    expect(screen.getAllByText(/PRV-000042/).length).toBeGreaterThan(0);
  });
});
