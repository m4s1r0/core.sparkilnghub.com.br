import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorBody, fullSession, json, renderApp, stubFetch } from "./support";

afterEach(() => vi.unstubAllGlobals());

const admin = (
  name: string,
  status: "ativo" | "inativo" | "convite_pendente",
  id = crypto.randomUUID(),
) => ({
  accountId: status === "convite_pendente" ? null : id,
  invitationId: status === "convite_pendente" ? id : null,
  displayName: status === "convite_pendente" ? null : name,
  email: `${name.toLowerCase()}@example.test`,
  status,
  lastLoginAt: status === "ativo" ? "2026-10-26T12:00:00.000Z" : null,
});

describe("AdminsPage (/administradores)", () => {
  it("lista estados; com um só ativo, inativar fica indisponível e o motivo aparece", async () => {
    stubFetch(({ url }) =>
      url.endsWith("/platform-admins")
        ? json({ items: [admin("Ana", "ativo"), admin("Carla", "convite_pendente")] })
        : json(fullSession),
    );
    renderApp("/administradores");
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Convite pendente")).toBeInTheDocument();
    expect(
      screen.getByText(/Há só um administrador ativo: ele não pode ser inativado/),
    ).toBeInTheDocument();
  });

  it("convite pede reautenticação, repete com a mesma chave e exibe o link uma vez", async () => {
    let invites = 0;
    let reauthenticated = false;
    const calls = stubFetch(({ url, method }) => {
      if (url.endsWith("/platform-admins/invitations")) {
        invites += 1;
        return reauthenticated
          ? json(
              { link: "http://127.0.0.1:3000/convite/abc", expiresAt: "2026-10-28T12:00:00.000Z" },
              201,
            )
          : json(errorBody("AUTH_REAUTH_REQUIRED", "Confirme o código."), 403);
      }
      if (url.endsWith("/auth/reauth") && method === "POST") {
        reauthenticated = true;
        return json(fullSession);
      }
      if (url.endsWith("/platform-admins")) return json({ items: [admin("Ana", "ativo")] });
      return json(fullSession);
    });
    renderApp("/administradores");
    await userEvent.click(await screen.findByRole("button", { name: "Convidar administrador" }));
    await userEvent.type(await screen.findByLabelText(/E-mail/), "bruno@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Gerar convite" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirme sua identidade" });
    await userEvent.type(within(dialog).getByLabelText(/Código do aplicativo/), "123456");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirmar e continuar" }));

    expect(
      await screen.findByDisplayValue("http://127.0.0.1:3000/convite/abc"),
    ).toBeInTheDocument();
    expect(invites).toBe(2);
    const keys = calls
      .filter((c) => c.url.endsWith("/platform-admins/invitations"))
      .map((c) => c.headers.get("idempotency-key"));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);

    // Fechar sem copiar pede confirmação.
    await userEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(screen.getByText("Fechar sem copiar?")).toBeInTheDocument();
  });

  it("inativar exige motivo e mostra o resultado", async () => {
    const bruno = admin("Bruno", "ativo");
    const calls = stubFetch(({ url }) => {
      if (url.endsWith("/deactivate")) return new Response(null, { status: 204 });
      if (url.endsWith("/platform-admins")) return json({ items: [admin("Ana", "ativo"), bruno] });
      return json(fullSession);
    });
    renderApp("/administradores");
    const trigger = await screen.findByRole("button", { name: "Ações para Bruno" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("menuitem", { name: "Inativar" }));

    const dialog = await screen.findByRole("dialog", { name: "Inativar administrador" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Inativar acesso de Bruno" }));
    expect(within(dialog).getByText(/Explique o motivo/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), "saiu da equipe");
    await userEvent.click(within(dialog).getByRole("button", { name: "Inativar acesso de Bruno" }));

    expect(await screen.findByText("Acesso de Bruno inativado.")).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith("/deactivate"))?.body).toEqual({
        reason: "saiu da equipe",
      }),
    );
  });
});
