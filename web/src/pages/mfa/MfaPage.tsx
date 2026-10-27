import { Alert, Button, Heading, Input, Text } from "@sparkling-hub/design-system";
import { type FormEvent, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { authApi, useRefreshSession } from "../../api/auth";
import { ApiError } from "../../api/client";
import { returnPath } from "../../app/auth-guard";
import { authErrorMessage } from "../login/LoginPage";

/** `/entrar/segundo-fator` — código TOTP ou código de recuperação (FR-006, FR-007). */
export function MfaPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const refresh = useRefreshSession();
  const summary = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const value = code.trim();
    const valid = mode === "totp" ? /^[0-9]{6}$/.test(value) : /^[A-Za-z2-7]{10}$/.test(value);
    if (!valid) {
      setFieldError(
        mode === "totp"
          ? "Informe os 6 dígitos do aplicativo."
          : "O código de recuperação tem 10 caracteres.",
      );
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      const { next } = await authApi.confirmMfa(
        mode === "totp" ? { code: value } : { recoveryCode: value.toUpperCase() },
      );
      await refresh();
      void navigate(next === "done" ? returnPath(location.state) : "/conta/seguranca/totp", {
        replace: true,
      });
    } catch (caught) {
      setCode("");
      if (caught instanceof ApiError && caught.code === "AUTH_MFA_INVALID") {
        setFieldError("Código inválido ou já usado. Confira o aplicativo e tente de novo.");
      } else {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError("Ocorreu uma falha inesperada.", null, null, "UNKNOWN"),
        );
        summary.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const expired = error?.status === 401;
  const message = error && !expired ? authErrorMessage(error) : null;
  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Confirme o segundo fator</Heading>
        <Text tone="muted">
          {mode === "totp"
            ? "Digite o código de 6 dígitos mostrado no aplicativo autenticador."
            : "Use um dos códigos de recuperação guardados no cadastro. Cada código vale uma vez."}
        </Text>
      </div>
      <div ref={summary} tabIndex={-1} className="outline-none">
        {expired && (
          <Alert tone="warning" title="Sua sessão expirou">
            <Link to="/entrar" className="underline underline-offset-4">
              Entre novamente com e-mail e senha
            </Link>
            .
          </Alert>
        )}
        {message && (
          <Alert tone={error?.status === 429 ? "warning" : "error"} title={message.title}>
            {message.body}
          </Alert>
        )}
      </div>
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
        <Input
          key={mode}
          label={mode === "totp" ? "Código do aplicativo" : "Código de recuperação"}
          name="code"
          inputMode={mode === "totp" ? "numeric" : "text"}
          autoComplete="one-time-code"
          maxLength={mode === "totp" ? 6 : 10}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          {...(fieldError ? { error: fieldError } : {})}
        />
        <Button type="submit" loading={submitting} disabled={expired}>
          {submitting ? "Confirmando…" : "Confirmar"}
        </Button>
      </form>
      <Button
        variant="ghost"
        onClick={() => {
          setMode(mode === "totp" ? "recovery" : "totp");
          setCode("");
          setFieldError(null);
        }}
      >
        {mode === "totp" ? "Usar código de recuperação" : "Usar o aplicativo autenticador"}
      </Button>
    </>
  );
}
