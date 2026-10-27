import { Alert, Button, Heading, PasswordInput, Text } from "@sparkling-hub/design-system";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";
import { accountsApi } from "../../api/accounts";
import { ApiError } from "../../api/client";
import { pendingText } from "../../api/members";

/**
 * `/recuperar/:token` — nova senha pelo link de uso único (FR-023, COM-018). Ao concluir, todas
 * as sessões da conta — painel e produtos — são encerradas.
 */
export function PasswordResetPage() {
  const { token = "" } = useParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (password.length < 12) next.password = "A senha precisa ter pelo menos 12 caracteres.";
    if (confirm !== password) next.confirm = "As senhas não conferem.";
    setErrors(next);
    setFailure(null);
    if (next.password ?? next.confirm) return;
    setSubmitting(true);
    try {
      const outcome = await accountsApi.completeReset(token, password);
      setDone(pendingText(outcome) ?? "");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "PASSWORD_POLICY_REJECTED") {
        setErrors({ password: caught.message });
      } else {
        setFailure(
          caught instanceof ApiError
            ? caught
            : new ApiError("Ocorreu uma falha inesperada.", null, null, "UNKNOWN"),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (done !== null) {
    return (
      <>
        <Heading level={1}>Senha alterada</Heading>
        <Alert tone="success" title="Pronto">
          Sua senha foi trocada e todas as sessões abertas foram encerradas, inclusive nos sistemas
          dos estabelecimentos. {done}
        </Alert>
        <Text>
          <Link to="/entrar" className="underline underline-offset-4">
            Entrar no SparkCore
          </Link>{" "}
          ou volte ao sistema do estabelecimento para entrar com a nova senha.
        </Text>
      </>
    );
  }

  const invalid = failure?.status === 404;
  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Definir nova senha</Heading>
        <Text tone="muted">O link vale por 30 minutos e uma única vez.</Text>
      </div>
      {failure && (
        <Alert
          tone="error"
          title={invalid ? "Link inválido ou expirado" : "Não foi possível trocar a senha"}
        >
          {invalid ? (
            <>
              Este link já foi usado, foi substituído ou expirou.{" "}
              <Link to="/recuperar" className="underline underline-offset-4">
                Pedir de novo
              </Link>
            </>
          ) : (
            failure.message
          )}
        </Alert>
      )}
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
        <PasswordInput
          label="Nova senha"
          name="password"
          autoComplete="new-password"
          hint="Pelo menos 12 caracteres. Frases longas são boas; evite senhas comuns."
          maxLength={128}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          {...(errors.password ? { error: errors.password } : {})}
        />
        <PasswordInput
          label="Repita a nova senha"
          name="confirm"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          {...(errors.confirm ? { error: errors.confirm } : {})}
        />
        <Button type="submit" loading={submitting} disabled={invalid}>
          {submitting ? "Salvando…" : "Salvar nova senha"}
        </Button>
      </form>
    </>
  );
}
