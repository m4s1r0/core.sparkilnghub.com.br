import {
  Alert,
  Button,
  Card,
  Heading,
  Input,
  PasswordInput,
  Skeleton,
  Text,
} from "@sparkling-hub/design-system";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { authApi, useRefreshSession } from "../../api/auth";
import { ApiError } from "../../api/client";
import { authErrorMessage } from "../login/LoginPage";

const POLICY_HINT = "Pelo menos 12 caracteres. Frases longas são boas; evite senhas comuns.";

type Fields = {
  displayName?: string;
  password?: string;
  confirm?: string;
  currentPassword?: string;
};

/** `/convite/:token` — aceite de convite com conta nova ou existente (FR-016, FR-019). */
export function InvitationPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const refresh = useRefreshSession();
  const summary = useRef<HTMLDivElement>(null);
  const invitation = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => authApi.inspectInvitation(token),
    retry: false,
  });
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Fields>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [acceptedInstance, setAcceptedInstance] = useState(false);

  if (invitation.isPending) {
    return <Skeleton label="Carregando convite" lines={4} />;
  }
  if (invitation.isError || !invitation.data) {
    const failure = invitation.error instanceof ApiError ? invitation.error : null;
    return (
      <>
        <Heading level={1}>Convite</Heading>
        <Alert tone="error" title="Convite inválido ou expirado">
          {failure?.status === 404 || !failure
            ? "Este convite não vale mais: já foi usado, foi substituído ou expirou. Peça um novo convite a quem enviou."
            : failure.message}
        </Alert>
      </>
    );
  }
  const preview = invitation.data;

  if (acceptedInstance) {
    return (
      <>
        <Heading level={1}>Convite aceito</Heading>
        <Alert tone="success" title="Acesso liberado">
          Seu acesso a {preview.instanceName ?? "esta instância"} foi liberado. Entre pelo sistema
          do estabelecimento com seu e-mail e senha.
        </Alert>
      </>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const errors: Fields = {};
    if (preview.accountExists) {
      if (!currentPassword) errors.currentPassword = "Informe a senha atual da sua conta.";
    } else {
      if (!displayName.trim()) errors.displayName = "Informe seu nome.";
      if (password.length < 12) errors.password = "A senha precisa ter pelo menos 12 caracteres.";
      if (confirm !== password) errors.confirm = "As senhas não conferem.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      summary.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const { next } = await authApi.acceptInvitation(
        token,
        preview.accountExists ? { currentPassword } : { displayName: displayName.trim(), password },
      );
      if (next === "done") {
        setAcceptedInstance(true);
        return;
      }
      await refresh();
      void navigate(next === "mfa" ? "/entrar/segundo-fator" : "/conta/seguranca/totp", {
        replace: true,
      });
    } catch (caught) {
      const apiError =
        caught instanceof ApiError
          ? caught
          : new ApiError("Ocorreu uma falha inesperada.", null, null, "UNKNOWN");
      if (apiError.code === "PASSWORD_POLICY_REJECTED") {
        setFieldErrors({ password: apiError.message });
      } else if (apiError.code === "AUTH_INVALID_CREDENTIALS") {
        setFieldErrors({ currentPassword: "Senha incorreta." });
      } else {
        setError(apiError);
      }
      summary.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const message = error
    ? error.code === "CONFLICT_INVITATION_ACCOUNT_MISMATCH"
      ? { title: "Conta diferente da convidada", body: error.message }
      : error.status === 404
        ? { title: "Convite inválido ou expirado", body: error.message }
        : authErrorMessage(error)
    : null;
  const target =
    preview.target === "plataforma"
      ? "administrador da plataforma SparkCore"
      : `${preview.roleLabel.toLowerCase()} em ${preview.instanceName ?? "uma instância"}`;

  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Aceitar convite</Heading>
        <Text tone="muted">
          Convite para {preview.emailMasked} como {target}.
        </Text>
      </div>
      <div ref={summary} tabIndex={-1} className="outline-none">
        {Object.keys(fieldErrors).length > 0 && !error && (
          <Alert tone="error" title="Revise os campos destacados">
            Corrija os campos indicados para continuar.
          </Alert>
        )}
        {message && (
          <Alert tone="error" title={message.title}>
            {message.body}
            {error?.code === "CONFLICT_INVITATION_ACCOUNT_MISMATCH" && (
              <>
                {" "}
                <Link to="/entrar" className="underline underline-offset-4">
                  Ir para a tela de entrada
                </Link>
              </>
            )}
          </Alert>
        )}
      </div>
      <Card title={preview.accountExists ? "Confirme que é você" : "Crie seu acesso"}>
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
          {preview.accountExists ? (
            <>
              <Text tone="muted">
                Você já tem conta. Informe sua senha atual; ela não será alterada.
              </Text>
              <PasswordInput
                label="Senha atual"
                name="currentPassword"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                {...(fieldErrors.currentPassword ? { error: fieldErrors.currentPassword } : {})}
              />
            </>
          ) : (
            <>
              <Input
                label="Seu nome"
                name="displayName"
                autoComplete="name"
                maxLength={120}
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                {...(fieldErrors.displayName ? { error: fieldErrors.displayName } : {})}
              />
              <PasswordInput
                label="Senha"
                name="password"
                autoComplete="new-password"
                hint={POLICY_HINT}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                {...(fieldErrors.password ? { error: fieldErrors.password } : {})}
              />
              <PasswordInput
                label="Repita a senha"
                name="confirm"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                {...(fieldErrors.confirm ? { error: fieldErrors.confirm } : {})}
              />
            </>
          )}
          <Button type="submit" loading={submitting}>
            {submitting ? "Aceitando…" : "Aceitar convite"}
          </Button>
        </form>
      </Card>
    </>
  );
}
