import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorBody, fullSession, json, preMfaSession, renderApp, stubFetch } from "./support";

afterEach(() => vi.unstubAllGlobals());

const noSession = () => json(errorBody("AUTH_SESSION_REQUIRED", "Sessão encerrada."), 401);

describe("guarda de rota", () => {
  it("sem sessão, o painel leva para /entrar", async () => {
    stubFetch(() => noSession());
    const { router } = renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Entrar no SparkCore" });
    expect(router.state.location.pathname).toBe("/entrar");
  });

  it("sessão pré-MFA com TOTP cadastrado vai para o segundo fator", async () => {
    stubFetch(() => json(preMfaSession(true)));
    const { router } = renderApp("/");
    await screen.findByRole("heading", { name: "Confirme o segundo fator" });
    expect(router.state.location.pathname).toBe("/entrar/segundo-fator");
  });
});

describe("LoginPage (/entrar)", () => {
  it("campos vazios: resumo de erros e mensagens nos campos, sem chamar a API", async () => {
    const calls = stubFetch(() => noSession());
    renderApp("/entrar");
    await userEvent.click(await screen.findByRole("button", { name: "Entrar" }));
    expect(screen.getByText("Revise os campos destacados")).toBeInTheDocument();
    expect(screen.getByLabelText(/E-mail/)).toHaveAttribute("aria-invalid", "true");
    expect(calls.filter((c) => c.url.endsWith("/auth/login"))).toHaveLength(0);
  });

  it.each([
    [401, "AUTH_INVALID_CREDENTIALS", "E-mail ou senha incorretos.", "E-mail ou senha incorretos."],
    [429, "AUTH_THROTTLED", "Muitas tentativas.", "aguarde cerca de 15 minutos"],
    [503, "SYSTEM_IDENTITY_UNAVAILABLE", "Indisponível.", "Serviço temporariamente indisponível"],
  ])("erro %i: mensagem segura", async (status, code, message, expected) => {
    stubFetch(({ url }) =>
      url.endsWith("/auth/login")
        ? json(errorBody(code, message), status, status === 429 ? { "retry-after": "900" } : {})
        : noSession(),
    );
    renderApp("/entrar");
    await userEvent.type(await screen.findByLabelText(/E-mail/), "ana@example.test");
    await userEvent.type(screen.getByLabelText(/^Senha/), "senha qualquer longa");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText(new RegExp(expected))).toBeInTheDocument();
    // A senha digitada é limpa depois da falha.
    expect(screen.getByLabelText(/^Senha/)).toHaveValue("");
  });

  it("senha correta → segundo fator", async () => {
    let loggedIn = false;
    const calls = stubFetch(({ url }) => {
      if (url.endsWith("/auth/login")) {
        loggedIn = true;
        return json({ next: "mfa" });
      }
      return loggedIn ? json(preMfaSession(true)) : noSession();
    });
    const { router } = renderApp("/entrar");
    await userEvent.type(await screen.findByLabelText(/E-mail/), "ana@example.test");
    await userEvent.type(screen.getByLabelText(/^Senha/), "senha qualquer longa");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await screen.findByRole("heading", { name: "Confirme o segundo fator" });
    expect(router.state.location.pathname).toBe("/entrar/segundo-fator");
    expect(calls.find((c) => c.url.endsWith("/auth/login"))?.body).toEqual({
      email: "ana@example.test",
      password: "senha qualquer longa",
    });
  });
});

describe("MfaPage (/entrar/segundo-fator)", () => {
  it("código inválido do servidor aparece no campo; recuperação troca o rótulo", async () => {
    stubFetch(({ url }) =>
      url.endsWith("/auth/mfa")
        ? json(errorBody("AUTH_MFA_INVALID", "Código inválido."), 401)
        : json(preMfaSession(true)),
    );
    renderApp("/entrar/segundo-fator");
    const input = await screen.findByLabelText(/Código do aplicativo/);
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    await userEvent.type(input, "123456");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/Código inválido ou já usado/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Usar código de recuperação" }));
    expect(screen.getByLabelText(/Código de recuperação/)).toBeInTheDocument();
  });

  it("sessão pré-MFA expirada: aviso e link para entrar de novo", async () => {
    stubFetch(({ url }) =>
      url.endsWith("/auth/mfa")
        ? json(errorBody("AUTH_SESSION_REQUIRED", "Sua sessão terminou."), 401)
        : json(preMfaSession(true)),
    );
    renderApp("/entrar/segundo-fator");
    await userEvent.type(await screen.findByLabelText(/Código do aplicativo/), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Sua sessão expirou")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Entre novamente/ })).toHaveAttribute(
      "href",
      "/entrar",
    );
  });
});

describe("InvitationPage (/convite/:token)", () => {
  const preview = (accountExists: boolean, target = "plataforma") => ({
    target,
    instanceName: target === "instancia" ? "[SINTÉTICO] Instância A" : null,
    roleLabel: target === "instancia" ? "Colaborador" : "Administrador da plataforma",
    emailMasked: "a***@example.test",
    accountExists,
    expiresAt: "2026-10-28T12:00:00.000Z",
  });

  it("convite inválido ou expirado: mesma mensagem", async () => {
    stubFetch(() => json(errorBody("INVITATION_INVALID", "Convite inválido."), 404));
    renderApp("/convite/abc");
    expect(await screen.findByText("Convite inválido ou expirado")).toBeInTheDocument();
  });

  it("conta nova: nome e senha; política recusada aparece no campo", async () => {
    stubFetch(({ method }) =>
      method === "POST"
        ? json(
            errorBody("PASSWORD_POLICY_REJECTED", "Essa senha é comum demais.", "/password"),
            422,
          )
        : json(preview(false)),
    );
    renderApp("/convite/abc");
    await userEvent.type(await screen.findByLabelText(/Seu nome/), "Ana");
    await userEvent.type(screen.getByLabelText(/^Senha/), "unbelievable");
    await userEvent.type(screen.getByLabelText(/Repita a senha/), "unbelievable");
    await userEvent.click(screen.getByRole("button", { name: "Aceitar convite" }));
    expect(await screen.findByText("Essa senha é comum demais.")).toBeInTheDocument();
  });

  it("conta existente: só a senha atual; convite de instância mostra sucesso", async () => {
    const calls = stubFetch(({ method }) =>
      method === "POST" ? json({ next: "done" }) : json(preview(true, "instancia")),
    );
    renderApp("/convite/abc");
    expect(await screen.findByText(/colaborador em \[SINTÉTICO\] Instância A/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Seu nome/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Senha atual/), "minha senha atual");
    await userEvent.click(screen.getByRole("button", { name: "Aceitar convite" }));
    expect(await screen.findByText("Acesso liberado")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      currentPassword: "minha senha atual",
    });
  });
});

describe("TotpEnrollmentPage (/conta/seguranca/totp)", () => {
  it("QR e segredo; confirmação mostra 10 códigos uma vez; Já guardei volta ao painel", async () => {
    let confirmed = false;
    stubFetch(({ url }) => {
      if (url.endsWith("/enrollment"))
        return json(
          { otpauthUri: "otpauth://totp/SparkCore:ana?secret=ABCD", secret: "ABCDEFGHIJKLMNOP" },
          201,
        );
      if (url.endsWith("/enrollment/confirm")) {
        confirmed = true;
        return json({
          codes: Array.from({ length: 10 }, (_, i) => `CODIGO${"ABCD"[i % 4]}${i}AA`.slice(0, 10)),
        });
      }
      if (url.endsWith("/system/status")) return json(errorBody("X", "x"), 500);
      return json(confirmed ? fullSession : preMfaSession(false));
    });
    const { router } = renderApp("/conta/seguranca/totp");
    expect(await screen.findByText("ABCD EFGH IJKL MNOP")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByAltText(/QR code para cadastrar/)).toHaveAttribute(
        "src",
        expect.stringMatching(/^data:image\/svg\+xml/),
      ),
    );
    await userEvent.type(screen.getByLabelText(/Código de 6 dígitos/), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar cadastro" }));
    const list = await screen.findByRole("list", { name: "Códigos de recuperação" });
    expect(list.querySelectorAll("li")).toHaveLength(10);
    await userEvent.click(screen.getByRole("button", { name: "Já guardei" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });
});
