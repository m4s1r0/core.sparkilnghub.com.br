import {
  Alert,
  Button,
  Card,
  Dialog,
  Heading,
  Input,
  Skeleton,
  Text,
} from "@sparkling-hub/design-system";
import { useQuery } from "@tanstack/react-query";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useBlocker, useLocation, useNavigate } from "react-router";
import { authApi, useRefreshSession } from "../../api/auth";
import { ApiError } from "../../api/client";
import { returnPath } from "../../app/auth-guard";

/** QR do URI otpauth em SVG (sem canvas), como imagem com texto alternativo. */
function QrImage({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((svg) => {
      if (active) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    });
    return () => {
      active = false;
    };
  }, [uri]);
  if (!src) return <Skeleton label="Gerando QR code" lines={4} />;
  return (
    <img
      src={src}
      alt="QR code para cadastrar o SparkCore no aplicativo autenticador"
      className="h-48 w-48 bg-white p-2"
    />
  );
}

/** Segredo em grupos de 4 para digitação manual. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/**
 * `/conta/seguranca/totp` — cadastro do TOTP (FR-006, FR-007). Os códigos de recuperação são
 * exibidos uma única vez; sair sem confirmar "Já guardei" pede confirmação (contracts/ui-f01.md).
 */
export function TotpEnrollmentPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const refresh = useRefreshSession();
  const enrollment = useQuery({
    queryKey: ["mfa-enrollment"],
    queryFn: authApi.startEnrollment,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const pending = codes !== null && !saved;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      pending && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const finish = () => {
    setSaved(true);
    // O bloqueio lê `saved` no próximo render; navega depois de desativá-lo.
    setTimeout(() => void navigate(returnPath(location.state), { replace: true }), 0);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!/^[0-9]{6}$/.test(code.trim())) {
      setFieldError("Informe os 6 dígitos mostrados no aplicativo.");
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      const result = await authApi.confirmEnrollment(code.trim());
      setCodes(result.codes);
      await refresh();
    } catch (caught) {
      setCode("");
      if (caught instanceof ApiError && caught.code === "AUTH_MFA_INVALID") {
        setFieldError("Código inválido. Confira o relógio do celular e tente o código atual.");
      } else {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError("Ocorreu uma falha inesperada.", null, null, "UNKNOWN"),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (codes) {
    return (
      <>
        <Heading level={1}>Guarde seus códigos de recuperação</Heading>
        <Alert tone="warning" title="Estes códigos aparecem só agora">
          Cada código permite entrar uma vez se você perder o celular. Guarde-os em local seguro,
          fora deste computador. Eles não poderão ser consultados de novo.
        </Alert>
        <Card title="Códigos de recuperação">
          <ol className="grid grid-cols-2 gap-2 font-mono" aria-label="Códigos de recuperação">
            {codes.map((recovery) => (
              <li key={recovery}>{recovery}</li>
            ))}
          </ol>
        </Card>
        <Button onClick={finish}>Já guardei</Button>
        <Dialog
          title="Sair sem guardar os códigos?"
          description="Os códigos de recuperação não poderão ser exibidos de novo."
          trigger={<span hidden />}
          open={blocker.state === "blocked"}
          onOpenChange={(open) => {
            if (!open && blocker.state === "blocked") blocker.reset();
          }}
          footer={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => blocker.reset?.()}>
                Continuar aqui
              </Button>
              <Button variant="danger" onClick={() => blocker.proceed?.()}>
                Sair sem guardar
              </Button>
            </div>
          }
        >
          <Text>
            Se sair agora, você só poderá recuperar o acesso pelo procedimento administrativo.
          </Text>
        </Dialog>
      </>
    );
  }

  if (enrollment.isPending) {
    return (
      <>
        <Heading level={1}>Cadastrar aplicativo autenticador</Heading>
        <Skeleton label="Preparando cadastro" lines={5} />
      </>
    );
  }
  if (enrollment.isError || !enrollment.data) {
    const failure = enrollment.error instanceof ApiError ? enrollment.error : null;
    const already = failure?.code === "CONFLICT_MFA_ALREADY_ENROLLED";
    return (
      <>
        <Heading level={1}>Cadastrar aplicativo autenticador</Heading>
        <Alert
          tone={already ? "info" : "error"}
          title={already ? "Já cadastrado" : "Não foi possível iniciar o cadastro"}
        >
          {already ? (
            <Link to="/" className="underline underline-offset-4">
              Voltar ao painel
            </Link>
          ) : (
            (failure?.message ?? "Ocorreu uma falha inesperada.")
          )}
        </Alert>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Cadastrar aplicativo autenticador</Heading>
        <Text tone="muted">
          O segundo fator é obrigatório para administradores da plataforma. Use um aplicativo como
          Google Authenticator, Microsoft Authenticator ou 1Password.
        </Text>
      </div>
      {error && (
        <Alert tone="error" title="Não foi possível confirmar">
          {error.message}
        </Alert>
      )}
      <Card title="1. Leia o QR code">
        <div className="flex flex-col items-start gap-3">
          <QrImage uri={enrollment.data.otpauthUri} />
          <Text tone="muted">Sem câmera? Digite este segredo no aplicativo:</Text>
          <code className="font-mono break-all" aria-label="Segredo para digitação manual">
            {grouped(enrollment.data.secret)}
          </code>
        </div>
      </Card>
      <Card title="2. Confirme com o código atual">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
          <Input
            label="Código de 6 dígitos"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            {...(fieldError ? { error: fieldError } : {})}
          />
          <Button type="submit" loading={submitting}>
            {submitting ? "Confirmando…" : "Confirmar cadastro"}
          </Button>
        </form>
      </Card>
    </>
  );
}
