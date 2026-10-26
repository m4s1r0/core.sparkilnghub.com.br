import type { SystemStatus } from "@sparkcore/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemStatusPage } from "../../src/pages/system-status/SystemStatusPage";

const CORRELATION = "0192f6b0-7c1e-7a3b-9d2e-5f8a1c3b4d6e";

function status(overrides: Partial<SystemStatus> = {}): SystemStatus {
  const checkedAt = "2026-10-26T12:00:00.000Z";
  return {
    service: "sparkcore",
    version: "0.1.0",
    environment: "development",
    status: "SAUDAVEL",
    checkedAt,
    components: [
      { name: "server", status: "SAUDAVEL", reason: null, checkedAt },
      { name: "worker", status: "DEGRADADA", reason: "WORKER_STALE", checkedAt },
      {
        name: "spark_core",
        status: "SAUDAVEL",
        schemaVersion: 2,
        expectedSchemaVersion: 2,
        reason: null,
        checkedAt,
      },
      {
        name: "spark_identity",
        status: "INDISPONIVEL",
        schemaVersion: null,
        expectedSchemaVersion: 1,
        reason: "DB_UNREACHABLE",
        checkedAt,
      },
    ],
    ...overrides,
  };
}

const json = (body: unknown, init: number) =>
  new Response(JSON.stringify(body), {
    status: init,
    headers: { "content-type": "application/json", "x-correlation-id": CORRELATION },
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemStatusPage />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("SystemStatusPage", () => {
  it("carregando: aria-busy, texto e nenhum número", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pending.promise),
    );
    renderPage();
    const region = await screen.findByTestId("status-region");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Consultando situação…")).toBeInTheDocument();
    expect(region.textContent).not.toMatch(/\d/);
    pending.resolve(json(status(), 200));
    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
  });

  it("sucesso 200: rótulos de estado em texto e correlação", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json(status(), 200))),
    );
    renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByText("Saudável").length).toBeGreaterThan(0);
    expect(within(table).getByText("Degradada")).toBeInTheDocument();
    expect(within(table).getByText("Indisponível")).toBeInTheDocument();
    expect(screen.getByText(CORRELATION, { exact: false })).toBeInTheDocument();
  });

  it("503: aviso de indisponibilidade e tabela com o corpo recebido", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json(status({ status: "INDISPONIVEL" }), 503))),
    );
    renderPage();
    expect(
      await screen.findByText("Um ou mais componentes estão indisponíveis"),
    ).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("erro de rede/500: mensagem segura, correlação e Tentar novamente, sem dados como atuais", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(status(), 200))
      .mockResolvedValueOnce(
        json(
          {
            error: {
              code: "INTERNAL_ERROR",
              message: "Ocorreu uma falha inesperada.",
              field: null,
              retryable: false,
              correlationId: CORRELATION,
            },
          },
          500,
        ),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Atualizar situação" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ocorreu uma falha inesperada.");
    expect(alert).toHaveTextContent(CORRELATION);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText(/Não foi possível consultar a situação/)).toBeInTheDocument();
    expect(alert.textContent ?? "").not.toMatch(/Failed to fetch|TypeError/);
  });

  it("atualizando: botão em loading e dados anteriores marcados", async () => {
    const second = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(status(), 200))
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Atualizar situação" }));
    expect(await screen.findByText("Atualizando…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Atualizar situação/ })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    second.resolve(json(status(), 200));
    await waitFor(() => expect(screen.queryByText("Atualizando…")).not.toBeInTheDocument());
  });
});
