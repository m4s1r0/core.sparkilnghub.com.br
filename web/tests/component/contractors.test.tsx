import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CORRELATION, errorBody, fullSession, json, renderApp, stubFetch } from "./support";

afterEach(() => vi.unstubAllGlobals());

const ID = "0192f6b0-0000-7000-8000-0000000000aa";
const contractor = (patch: Record<string, unknown> = {}) => ({
  id: ID,
  legalName: "Pet Feliz Ltda",
  displayName: "Pet Feliz",
  personType: "juridica",
  document: "11222333000181",
  contactName: "Fernanda",
  email: "contato@petfeliz.example.test",
  phone: null,
  address: null,
  status: "ativo",
  version: 3,
  createdAt: "2026-10-27T12:00:00.000Z",
  updatedAt: "2026-10-27T12:00:00.000Z",
  instances: [],
  ...patch,
});

const page = (items: unknown[]) => ({
  items,
  pageInfo: { page: 1, pageSize: 20, total: items.length },
});

describe("ContractorsPage (/contratantes)", () => {
  it("vazio sem filtros mostra estado inicial com ação de cadastro", async () => {
    stubFetch(({ url }) => (url.includes("/contractors") ? json(page([])) : json(fullSession)));
    renderApp("/contratantes");
    expect(await screen.findByText("Nenhum contratante cadastrado")).toBeInTheDocument();
  });

  it("lista com documento formatado; erro de carga oferece nova tentativa", async () => {
    let fail = true;
    stubFetch(({ url }) => {
      if (!url.includes("/contractors")) return json(fullSession);
      if (fail) return json(errorBody("SYSTEM_DEPENDENCY_UNAVAILABLE", "Indisponível."), 503);
      return json(
        page([
          {
            id: ID,
            displayName: "Pet Feliz",
            legalName: "Pet Feliz Ltda",
            personType: "juridica",
            document: "11222333000181",
            status: "ativo",
            products: ["sparkref"],
            instanceCount: 2,
          },
        ]),
      );
    });
    renderApp("/contratantes");
    expect(
      await screen.findByText("Não foi possível carregar os contratantes"),
    ).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("11.222.333/0001-81")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pet Feliz" })).toHaveAttribute(
      "href",
      `/contratantes/${ID}`,
    );
  });
});

async function fillRequired() {
  await userEvent.type(await screen.findByLabelText(/Razão social/), "Pet Feliz Ltda");
  await userEvent.type(screen.getByLabelText(/Nome de exibição/), "Pet Feliz");
  await userEvent.type(screen.getByLabelText(/Contato responsável/), "Fernanda");
  await userEvent.type(screen.getByLabelText(/^E-mail/), "contato@petfeliz.example.test");
}

describe("ContractorFormPage (/contratantes/novo)", () => {
  it("homônimos aparecem antes de criar; continuar envia uma única criação", async () => {
    const calls = stubFetch(({ url, method }) => {
      if (url.includes("/contractors/similar")) {
        return json({
          items: [
            {
              id: "0192f6b0-0000-7000-8000-0000000000bb",
              displayName: "PET FELIZ",
              legalName: "PET FELIZ",
              document: null,
              status: "ativo",
              match: "nome",
            },
          ],
        });
      }
      if (url.endsWith("/api/v1/contractors") && method === "POST") return json(contractor(), 201);
      if (url.includes(`/contractors/${ID}`)) return json(contractor());
      return json(fullSession);
    });
    renderApp("/contratantes/novo");
    await fillRequired();
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar contratante" }));
    expect(await screen.findByText("Possíveis contratantes já cadastrados")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Continuar mesmo assim" }));
    expect(await screen.findByRole("heading", { name: "Pet Feliz" })).toBeInTheDocument();
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("documento inválido aparece no campo; documento já usado aponta o existente", async () => {
    let attempt = 0;
    stubFetch(({ url, method }) => {
      if (url.includes("/contractors/similar")) return json({ items: [] });
      if (url.endsWith("/api/v1/contractors") && method === "POST") {
        attempt += 1;
        return attempt === 1
          ? json(
              errorBody("VALIDATION_FAILED", "CNPJ inválido. Confira os dígitos.", "/document"),
              422,
            )
          : json(
              {
                error: {
                  ...errorBody(
                    "CONFLICT_DOCUMENT_TAKEN",
                    "Este documento já pertence a outro contratante.",
                    "/document",
                  ).error,
                  details: [{ field: "/document", code: ID, message: "Pet Feliz Matriz" }],
                },
              },
              409,
            );
      }
      return json(fullSession);
    });
    renderApp("/contratantes/novo");
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/CNPJ/), "11.222.333/0001-80");
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar contratante" }));
    expect(await screen.findByText("CNPJ inválido. Confira os dígitos.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cadastrar contratante" }));
    expect(await screen.findByRole("link", { name: "Pet Feliz Matriz" })).toHaveAttribute(
      "href",
      `/contratantes/${ID}`,
    );
    expect(screen.getByLabelText(/Razão social/)).toHaveValue("Pet Feliz Ltda");
  });

  it("conflito de versão na edição preserva o que foi digitado", async () => {
    let version = 3;
    stubFetch(({ url, method }) => {
      if (url.includes(`/contractors/${ID}`) && method === "PUT") {
        return json(
          errorBody("CONFLICT_VERSION", "O cadastro foi alterado por outra pessoa."),
          409,
        );
      }
      if (url.includes(`/contractors/${ID}`)) return json(contractor({ version: version++ }));
      return json(fullSession);
    });
    renderApp(`/contratantes/${ID}/editar`);
    const name = await screen.findByLabelText(/Nome de exibição/);
    await userEvent.clear(name);
    await userEvent.type(name, "Pet Feliz Centro");
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(await screen.findByText("Outra pessoa alterou este contratante")).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome de exibição/)).toHaveValue("Pet Feliz Centro");
  });
});

describe("ContractorPage (/contratantes/:id)", () => {
  it("inativação recusada lista as instâncias ativas e não muda nada", async () => {
    stubFetch(({ url, method }) => {
      if (url.endsWith(`/contractors/${ID}/inactivate`) && method === "POST") {
        return json(
          {
            error: {
              code: "CONFLICT_CONTRACTOR_HAS_ACTIVE_INSTANCES",
              message: "Há instâncias ativas deste contratante.",
              field: "/instances",
              retryable: false,
              correlationId: CORRELATION,
              details: [
                {
                  field: "/instances",
                  code: "0192f6b0-0000-7000-8000-0000000000cc",
                  message: "Loja Centro",
                },
              ],
            },
          },
          409,
        );
      }
      if (url.includes(`/contractors/${ID}`)) return json(contractor());
      return json(fullSession);
    });
    renderApp(`/contratantes/${ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Ações" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Inativar" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), "fim do contrato");
    await userEvent.click(within(dialog).getByRole("button", { name: "Inativar Pet Feliz" }));
    expect(
      await screen.findByText("Inativação recusada: há instâncias ativas"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Loja Centro" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Ativo")).toBeInTheDocument());
  });
});
