import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorBody, fullSession, json, renderApp, stubFetch } from "./support";

afterEach(() => vi.unstubAllGlobals());

const CONTRACTOR = "0192f6b0-0000-7000-8000-0000000000aa";
const INSTANCE = "0192f6b0-0000-7000-8000-0000000000bb";

const product = (code: string, provisionable: boolean) => ({
  code,
  name: code === "sparkpet" ? "SparkPet" : "Referência",
  description: "",
  status: "ativo",
  provisioner: provisionable ? `${code}-v1` : null,
  deployedVersion: provisionable ? 2 : null,
  supportedSchemaVersion: provisionable ? 2 : null,
  provisionable,
  notProvisionableReason: provisionable ? null : "SEM_PROVISIONADOR",
  version: 1,
});

function backend(overrides: Partial<Record<string, () => Response>> = {}) {
  return stubFetch(({ url, method }) => {
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (url.includes(pattern) && handler) return handler();
    }
    if (url.includes("/api/v1/contractors")) {
      return json({
        items: [
          {
            id: CONTRACTOR,
            displayName: "Pet Feliz",
            legalName: "Pet Feliz Ltda",
            personType: "juridica",
            document: null,
            status: "ativo",
            products: [],
            instanceCount: 0,
          },
        ],
        pageInfo: { page: 1, pageSize: 100, total: 1 },
      });
    }
    if (url.endsWith("/api/v1/products")) {
      return json({ items: [product("sparkpet", false), product("sparkref", true)] });
    }
    if (url.endsWith("/instances/timezones")) {
      return json({ items: ["America/Sao_Paulo", "America/Manaus"], default: "America/Sao_Paulo" });
    }
    if (url.endsWith("/instances/preview") && method === "POST") {
      return json({
        slug: "loja-centro",
        slugAvailable: true,
        contractor: { id: CONTRACTOR, displayName: "Pet Feliz" },
        product: product("sparkref", true),
        timezone: "America/Sao_Paulo",
        initialAdminEmail: "dona@example.test",
      });
    }
    if (url.includes(`/instances/${INSTANCE}/provisioning`)) {
      return json({
        id: "0192f6b0-0000-7000-8000-0000000000cc",
        protocol: "PRV-000042",
        instanceId: INSTANCE,
        instanceState: "CADASTRADA",
        status: "pendente",
        currentStep: null,
        runNumber: 1,
        attempt: 0,
        maxAttempts: 5,
        nextAttemptAt: null,
        artifactVersion: 2,
        error: null,
        steps: [],
        createdAt: "2026-10-27T12:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      });
    }
    return json(fullSession);
  });
}

async function fillUntilReview() {
  await screen.findByRole("option", { name: "Pet Feliz" });
  await userEvent.selectOptions(screen.getByLabelText(/Contratante/), CONTRACTOR);
  await screen.findByRole("option", { name: "Referência" });
  await userEvent.selectOptions(screen.getByLabelText(/Produto/), "sparkref");
  await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
  await userEvent.type(await screen.findByLabelText(/Nome de exibição/), "Loja Centro");
  await userEvent.type(screen.getByLabelText(/Identificador de acesso/), "Loja Centro!");
  await userEvent.type(
    screen.getByLabelText(/E-mail do administrador inicial/),
    "dona@example.test",
  );
  await userEvent.click(screen.getByRole("button", { name: "Revisar" }));
}

describe("NewInstancePage (/instancias/nova)", () => {
  it("produto não provisionável aparece desabilitado com o motivo", async () => {
    backend();
    renderApp("/instancias/nova");
    const option = await screen.findByRole("option", {
      name: /SparkPet — O produto ainda não publicou seu artefato/,
    });
    expect(option).toBeDisabled();
  });

  it("revisão mostra o slug normalizado; slug em uso volta ao campo", async () => {
    let available = false;
    backend({
      "/instances/preview": () =>
        json({
          slug: "loja-centro",
          slugAvailable: available,
          contractor: { id: CONTRACTOR, displayName: "Pet Feliz" },
          product: product("sparkref", true),
          timezone: "America/Sao_Paulo",
          initialAdminEmail: "dona@example.test",
        }),
    });
    renderApp("/instancias/nova");
    await fillUntilReview();
    expect(await screen.findByText(/"loja-centro" já está em uso/)).toBeInTheDocument();
    available = true;
    await userEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect(await screen.findByText("loja-centro")).toBeInTheDocument();
    expect(screen.getByText(/normalizado de “Loja Centro!”/)).toBeInTheDocument();
  });

  it("pede reautenticação e repete com a mesma chave de idempotência", async () => {
    let attempts = 0;
    let reauthenticated = false;
    const calls = backend({
      "/auth/reauth": () => {
        reauthenticated = true;
        return json(fullSession);
      },
    });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/v1/instances") && init?.method === "POST") {
        attempts += 1;
        calls.push({
          method: "POST",
          url,
          body: undefined,
          headers: new Headers(init.headers),
        });
        return Promise.resolve(
          reauthenticated
            ? json(
                {
                  instance: { id: INSTANCE },
                  task: { id: "t", protocol: "PRV-000042", status: "pendente" },
                },
                201,
              )
            : json(errorBody("AUTH_REAUTH_REQUIRED", "Confirme o código."), 403),
        );
      }
      return original(input, init);
    });
    renderApp("/instancias/nova");
    await fillUntilReview();
    await userEvent.click(await screen.findByRole("button", { name: "Confirmar e solicitar" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirme sua identidade" });
    await userEvent.type(within(dialog).getByLabelText(/Código do aplicativo/), "123456");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirmar e continuar" }));
    expect(
      await screen.findByRole("heading", { name: "Provisionamento PRV-000042" }),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
    const keys = calls
      .filter((c) => c.url.endsWith("/api/v1/instances"))
      .map((c) => c.headers.get("idempotency-key"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});
