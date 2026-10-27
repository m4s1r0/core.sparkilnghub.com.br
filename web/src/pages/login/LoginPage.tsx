import { Alert, Button, Heading, Input, PasswordInput, Text } from "@sparkling-hub/design-system";
import { type FormEvent, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { authApi, retryText, useRefreshSession } from "../../api/auth";
import { ApiError } from "../../api/client";

/** Mensagem segura por situação (contracts/ui-f01.md: login). */
export function authErrorMessage(error: ApiError): { title: string; body: string } {
  if (error.status === 429) {
    return {
      title: "Muitas tentativas",
      body: `Por segurança, aguarde ${retryText(error)} antes de tentar de novo.`,
    };
  }
  if (error.status === 503) {
    return {
      title: "Serviço temporariamente indisponível",
      body: "Não foi possível falar com o serviço de identidade. Tente novamente em instantes.",
    };
  }
  return { title: "Não foi possível entrar", body: error.message };
}

/** `/entrar` — e-mail e senha; o segundo fator vem na próxima tela (FR-006). */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const refresh = useRefreshSession();
  const summary = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = "Informe o e-mail.";
    if (!password) errors.password = "Informe a senha.";
    setFieldErrors(errors);
    setError(null);
    if (errors.email || errors.password) {
      summary.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const { next } = await authApi.login(email.trim(), password);
      await refresh();
      void navigate(next === "mfa" ? "/entrar/segundo-fator" : "/conta/seguranca/totp", {
        replace: true,
        state: location.state as unknown,
      });
    } catch (caught) {
      setPassword("");
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError("Ocorreu uma falha inesperada.", null, null, "UNKNOWN"),
      );
      summary.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const hasFieldErrors = Boolean(fieldErrors.email ?? fieldErrors.password);
  const message = error ? authErrorMessage(error) : null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Entrar no SparkCore</Heading>
        <Text tone="muted">Acesso restrito à equipe de administração da plataforma.</Text>
      </div>
      <div ref={summary} tabIndex={-1} className="outline-none">
        {hasFieldErrors && (
          <Alert tone="error" title="Revise os campos destacados">
            Preencha e-mail e senha para continuar.
          </Alert>
        )}
        {message && (
          <Alert tone={error?.status === 429 ? "warning" : "error"} title={message.title}>
            <div className="flex flex-col gap-1">
              <span>{message.body}</span>
              {error?.status !== 401 && error?.correlationId && (
                <span>Correlação: {error.correlationId}</span>
              )}
            </div>
          </Alert>
        )}
      </div>
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
        <Input
          label="E-mail"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...(fieldErrors.email ? { error: fieldErrors.email } : {})}
        />
        <PasswordInput
          label="Senha"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
        />
        <Button type="submit" loading={submitting}>
          {submitting ? "Entrando…" : "Entrar"}
        </Button>
      </form>
      <Text tone="muted">
        <Link to="/recuperar" className="underline underline-offset-4">
          Esqueci minha senha
        </Link>
      </Text>
    </>
  );
}
