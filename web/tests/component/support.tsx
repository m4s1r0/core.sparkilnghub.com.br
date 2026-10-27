import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { routes } from "../../src/app/routes";

export const CORRELATION = "0192f6b0-7c1e-7a3b-9d2e-5f8a1c3b4d6e";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-correlation-id": CORRELATION, ...headers },
  });

export const errorBody = (code: string, message: string, field: string | null = null) => ({
  error: { code, message, field, retryable: false, correlationId: CORRELATION },
});

export type Handler = (request: { method: string; url: string; body: unknown }) => Response;

/** `fetch` falso: cada chamada passa por `handler`; as chamadas ficam registradas. */
export function stubFetch(handler: Handler) {
  const calls: { method: string; url: string; body: unknown; headers: Headers }[] = [];
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url, body, headers: new Headers(init?.headers) });
    return Promise.resolve(handler({ method, url, body }));
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

export const fullSession = {
  account: {
    id: "0192f6b0-0000-7000-8000-000000000001",
    displayName: "Ana",
    email: "ana@example.test",
  },
  mfa: { enrolled: true, confirmed: true, reauthValidUntil: null },
  platformRole: "administrador",
};

export const preMfaSession = (enrolled: boolean) => ({
  ...fullSession,
  mfa: { enrolled, confirmed: false, reauthValidUntil: null },
});

/** Renderiza o app inteiro (rotas reais) a partir de `path`. */
export function renderApp(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, router };
}

const INSTANCE = "0192f6b0-0000-7000-8000-0000000000bb";

/** Tarefa de provisionamento para as telas de acompanhamento (contrato `ProvisioningTask`). */
export const task = (patch: Record<string, unknown> = {}) => ({
  id: "0192f6b0-0000-7000-8000-0000000000cc",
  protocol: "PRV-000042",
  instanceId: INSTANCE,
  instanceState: "PROVISIONANDO",
  status: "em_execucao",
  currentStep: "aplicar_migracoes",
  runNumber: 1,
  attempt: 0,
  maxAttempts: 5,
  nextAttemptAt: null,
  artifactVersion: 2,
  error: null,
  steps: [
    {
      step: "criar_bancos",
      runNumber: 1,
      attempt: 1,
      status: "concluida",
      startedAt: "2026-10-27T12:00:00.000Z",
      finishedAt: "2026-10-27T12:00:01.000Z",
      durationMs: 1000,
      errorCode: null,
    },
  ],
  createdAt: "2026-10-27T12:00:00.000Z",
  startedAt: "2026-10-27T12:00:00.000Z",
  finishedAt: null,
  ...patch,
});
