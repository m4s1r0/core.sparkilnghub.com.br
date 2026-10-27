import { Alert, Button, Dialog, Text } from "@sparkling-hub/design-system";
import { useState } from "react";
import type { OneTimeLink } from "../api/admins";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

/**
 * Link de uso único exibido uma vez (D-07, contracts/ui-f01.md): botão "Copiar" e aviso de que
 * não poderá ser consultado de novo; fechar sem copiar pede confirmação.
 */
export function OneTimeLinkDialog({
  title,
  link,
  onClose,
}: {
  title: string;
  link: OneTimeLink | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const close = () => {
    setCopied(false);
    setConfirming(false);
    setCopyFailed(false);
    onClose();
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.link);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <Dialog
      title={title}
      description="Entregue o link por um canal seguro. Ele aparece só agora."
      trigger={<span hidden />}
      open={link !== null}
      onOpenChange={(open) => {
        if (open) return;
        if (copied || confirming) close();
        else setConfirming(true);
      }}
    >
      <div className="flex flex-col gap-4">
        <Alert tone="warning" title="Link exibido uma única vez">
          Depois de fechar, o link não poderá ser consultado de novo. Se perder, gere outro (o
          anterior deixa de valer).
        </Alert>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Link de uso único</span>
          <input
            readOnly
            value={link?.link ?? ""}
            aria-label="Link de uso único"
            className="w-full break-all rounded border border-[var(--color-sh-line)] px-3 py-2 font-mono text-sm"
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        {link && <Text tone="muted">Válido até {dateTime.format(new Date(link.expiresAt))}.</Text>}
        <div role="status">
          {copied && <Text>Link copiado.</Text>}
          {copyFailed && (
            <Text>Não foi possível copiar; selecione o link e copie manualmente.</Text>
          )}
        </div>
        {confirming && !copied ? (
          <Alert tone="warning" title="Fechar sem copiar?">
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={close}>
                Fechar sem copiar
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Voltar
              </Button>
            </div>
          </Alert>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void copy()}>Copiar link</Button>
            <Button variant="secondary" onClick={() => (copied ? close() : setConfirming(true))}>
              Concluir
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
