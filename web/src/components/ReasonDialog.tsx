import { Alert, Button, Dialog, Textarea } from "@sparkling-hub/design-system";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

export interface ReasonRequest {
  title: string;
  description: string;
  /** Texto do botão que diz o resultado ("Revogar acesso de Ana à Instância A"). */
  confirmLabel: string;
  danger?: boolean;
  /** Campos adicionais acima do motivo (ex.: novo papel). */
  extra?: ReactNode;
  onConfirm: (reason: string) => Promise<void>;
}

/**
 * Ação que exige motivo (contracts/ui-f01.md: ação perigosa). O motivo digitado fica no estado
 * deste componente, fora do conteúdo do Dialog, e sobrevive a erro e a novo envio.
 */
export function ReasonDialog({
  request,
  onClose,
  error,
}: {
  request: ReasonRequest | null;
  onClose: () => void;
  /** Erro mostrado dentro do diálogo (ex.: conflito de versão), mantendo o motivo. */
  error?: string | null;
}) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!request) {
      setReason("");
      setFieldError(null);
    }
  }, [request]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!request) return;
    if (reason.trim().length < 3) {
      setFieldError("Explique o motivo (pelo menos 3 caracteres).");
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      await request.onConfirm(reason.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title={request?.title ?? ""}
      description={request?.description ?? ""}
      trigger={<span hidden />}
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
        {error && (
          <Alert tone="error" title="Não foi possível concluir">
            {error}
          </Alert>
        )}
        {request?.extra}
        <Textarea
          label="Motivo"
          name="reason"
          maxLength={500}
          rows={3}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          {...(fieldError ? { error: fieldError } : {})}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant={request?.danger ? "danger" : "primary"}
            loading={submitting}
          >
            {request?.confirmLabel ?? "Confirmar"}
          </Button>
          <Button variant="secondary" disabled={submitting} onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
