import { Alert, Button, Heading, Input, Text } from "@sparkling-hub/design-system";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { accountsApi } from "../../api/accounts";
import { retryText } from "../../api/auth";
import { ApiError } from "../../api/client";

/**
 * `/recuperar` — pedido de recuperação (D-07, R-11). A resposta é sempre a mesma, exista a conta
 * ou não; o link é gerado por um administrador da plataforma e entregue por canal seguro.
 */
export function RecoveryRequestPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError("Informe um e-mail válido.");
      return;
    }
    setFieldError(null);
    setError(null);
    setSubmitting(true);
    try {
      await accountsApi.requestRecovery(email.trim());
      setSent(true);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError("Ocorreu uma falha inesperada.", null, null, "UNKNOWN"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Recuperar acesso</Heading>
        <Text tone="muted">
          Informe o e-mail da sua conta. Por segurança, o link de recuperação é gerado pela equipe
          de administração e entregue a você por um canal seguro.
        </Text>
      </div>
      <div role="status">
        {sent && (
          <Alert tone="success" title="Pedido registrado">
            Se houver conta com este e-mail, a equipe de administração foi avisada e entrará em
            contato.
          </Alert>
        )}
      </div>
      {error && (
        <Alert
          tone="warning"
          title={error.status === 429 ? "Muitos pedidos" : "Não foi possível registrar"}
        >
          {error.status === 429
            ? `Aguarde ${retryText(error)} antes de pedir de novo.`
            : error.message}
        </Alert>
      )}
      {!sent && (
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
          <Input
            label="E-mail"
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...(fieldError ? { error: fieldError } : {})}
          />
          <Button type="submit" loading={submitting}>
            {submitting ? "Enviando…" : "Pedir recuperação"}
          </Button>
        </form>
      )}
      <Text tone="muted">
        <Link to="/entrar" className="underline underline-offset-4">
          Voltar para entrar
        </Link>
      </Text>
    </>
  );
}
