import { Alert, Button, Dialog } from "@sparkling-hub/design-system";
import { useState } from "react";

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}

/**
 * Confirmação sem motivo (ex.: reativar, sair da manutenção — o motivo da entrada já foi
 * registrado, e sair não pede um novo). Mesmo padrão do `ReasonDialog`, sem o campo de texto.
 */
export function ConfirmDialog({
  request,
  onClose,
  error,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
  error?: string | null;
}) {
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!request) return;
    setSubmitting(true);
    try {
      await request.onConfirm();
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
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="error" title="Não foi possível concluir">
            {error}
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant={request?.danger ? "danger" : "primary"}
            loading={submitting}
            onClick={() => void submit()}
          >
            {request?.confirmLabel ?? "Confirmar"}
          </Button>
          <Button variant="secondary" disabled={submitting} onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
