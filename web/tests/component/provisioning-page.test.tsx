import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorBody, fullSession, json, renderApp, stubFetch, task } from "./support";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const INSTANCE = "0192f6b0-0000-7000-8000-0000000000bb";

describe("ProvisioningPage (/instancias/:id/provisionamento)", () => {
  it("em andamento consulta de novo; para de consultar quando a tarefa conclui", async () => {
    let calls = 0;
    stubFetch(({ url }) => {
      if (url.includes("/provisioning")) {
        calls += 1;
        return json(
          calls === 1
            ? task()
            : task({ status: "concluida", instanceState: "PRONTA", currentStep: null }),
        );
      }
      // O bloco do convite inicial consulta o detalhe; aqui ele não está disponível.
      if (url.endsWith(`/instances/${INSTANCE}`)) {
        return json(errorBody("NOT_FOUND", "Não encontrada."), 404);
      }
      return json(fullSession);
    });
    renderApp(`/instancias/${INSTANCE}/provisionamento`);
    expect(await screen.findByText(/Em andamento: Migrações/)).toBeInTheDocument();
    expect(await screen.findByText("Instância pronta", {}, { timeout: 4_000 })).toBeInTheDocument();
    const after = calls;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(calls).toBe(after);
    expect(
      screen.getByText(/ficará disponível aos usuários depois da ativação/),
    ).toBeInTheDocument();
  }, 15_000);

  it("aguardando repetição mostra a próxima tentativa e a contagem", async () => {
    stubFetch(({ url }) =>
      url.includes("/provisioning")
        ? json(
            task({
              status: "aguardando_repeticao",
              attempt: 2,
              nextAttemptAt: "2026-10-27T12:05:00.000Z",
              error: {
                code: "PROVISIONING_DEPENDENCY_UNAVAILABLE",
                message: "O banco de dados ficou indisponível durante o provisionamento.",
                step: "aplicar_migracoes",
                retryable: true,
              },
            }),
          )
        : json(fullSession),
    );
    renderApp(`/instancias/${INSTANCE}/provisionamento`);
    expect(await screen.findByText("Aguardando nova tentativa")).toBeInTheDocument();
    expect(screen.getByText(/\(2 de 5\)/)).toBeInTheDocument();
  });
});
