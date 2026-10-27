import { Alert, Button, Dialog, Input, Text } from "@sparkling-hub/design-system";
import { type FormEvent, useCallback, useRef, useState } from "react";
import { authApi, useRefreshSession } from "../api/auth";
import { ApiError } from "../api/client";

/**
 * Reautenticação para ações sensíveis (FR-008, contracts/ui-f01.md): se a API responde
 * `AUTH_REAUTH_REQUIRED`, abre um diálogo pedindo o código do aplicativo e repete a ação após o
 * sucesso. O código nunca é guardado. Uso:
 *
 *   const reauth = useReauth();
 *   await reauth.run(() => api.acao());
 *   return <>{...}{reauth.dialog}</>;
 */
export function useReauth() {
  const refresh = useRefreshSession();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef<{ retry: () => void; cancel: () => void } | null>(null);

  const run = useCallback(<T,>(action: () => Promise<T>): Promise<T> => {
    return action().catch((caught: unknown) => {
      if (!(caught instanceof ApiError) || caught.code !== "AUTH_REAUTH_REQUIRED") throw caught;
      return new Promise<T>((resolve, reject) => {
        pending.current = {
          retry: () => void action().then(resolve, reject),
          cancel: () => reject(caught),
        };
        setCode("");
        setError(null);
        setOpen(true);
      });
    });
  }, []);

  const close = () => {
    setOpen(false);
    pending.current?.cancel();
    pending.current = null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[0-9]{6}$/.test(code.trim())) {
      setError("Informe os 6 dígitos do aplicativo.");
      return;
    }
    setSubmitting(true);
    try {
      await authApi.reauth(code.trim());
      await refresh();
      setOpen(false);
      pending.current?.retry();
      pending.current = null;
    } catch (caught) {
      setCode("");
      setError(
        caught instanceof ApiError && caught.code === "AUTH_MFA_INVALID"
          ? "Código inválido ou já usado. Aguarde o próximo código e tente de novo."
          : caught instanceof ApiError
            ? caught.message
            : "Ocorreu uma falha inesperada.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const dialog = (
    <Dialog
      title="Confirme sua identidade"
      description="Esta ação é sensível. Informe o código atual do aplicativo autenticador."
      trigger={<span hidden />}
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
        {error && (
          <Alert tone="error" title="Não foi possível confirmar">
            {error}
          </Alert>
        )}
        <Text tone="muted">A confirmação vale por 5 minutos.</Text>
        <Input
          label="Código do aplicativo"
          name="reauth-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={submitting}>
            {submitting ? "Confirmando…" : "Confirmar e continuar"}
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );

  return { run, dialog };
}
