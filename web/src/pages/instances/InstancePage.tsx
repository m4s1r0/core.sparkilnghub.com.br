import {
  Alert,
  Badge,
  Button,
  DescriptionList,
  Heading,
  Input,
  ListGroup,
  Skeleton,
  Tabs,
  Text,
  Textarea,
} from "@sparkling-hub/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/client";
import {
  type InstanceDetail,
  instanceKey,
  instancesApi,
  STATE_LABEL,
  useInstance,
} from "../../api/instances";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

/** `/instancias/:id` — resumo editável, linha do tempo e atalhos (US6, SC-014 a SC-018). */
export function InstancePage() {
  const { id = "" } = useParams();
  const instance = useInstance(id);
  if (instance.isPending) return <Skeleton label="Carregando instância" lines={6} />;
  if (instance.isError) {
    const notFound = instance.error instanceof ApiError && instance.error.status === 404;
    return (
      <Alert tone="error" title={notFound ? "Instância não encontrada" : "Falha ao carregar"}>
        <Link to="/instancias" className="underline underline-offset-4">
          Voltar às instâncias
        </Link>
      </Alert>
    );
  }
  return <InstanceView instance={instance.data} />;
}

function InstanceView({ instance }: { instance: InstanceDetail }) {
  const state = STATE_LABEL[instance.state];
  return (
    <>
      <div className="flex flex-col gap-2">
        <Heading level={1}>{instance.displayName}</Heading>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={state.tone}>{state.label}</Badge>
          {instance.synthetic && <Badge tone="neutral">Sintética</Badge>}
          <Text tone="muted">
            <code>{instance.slug}</code> · {instance.productCode}
          </Text>
        </div>
      </div>
      {instance.validityExpired && (
        <Alert tone="warning" title="Vigência vencida">
          A data de fim da vigência já passou. É só uma pendência administrativa: o estado da
          instância não muda e nada é cobrado.
        </Alert>
      )}
      <Tabs
        label="Seções da instância"
        items={[
          { id: "resumo", label: "Resumo", content: <Summary instance={instance} /> },
          { id: "linha", label: "Linha do tempo", content: <Timeline instance={instance} /> },
          {
            id: "vinculos",
            label: "Vínculos",
            content: (
              <Text>
                <Link
                  to={`/instancias/${instance.id}/vinculos`}
                  className="underline underline-offset-4"
                >
                  Vínculos de {instance.displayName}
                </Link>
              </Text>
            ),
          },
        ]}
      />
    </>
  );
}

function Summary({ instance }: { instance: InstanceDetail }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(instance.displayName);
  const [notes, setNotes] = useState(instance.notes ?? "");
  const [validFrom, setValidFrom] = useState(instance.validFrom ?? "");
  const [validUntil, setValidUntil] = useState(instance.validUntil ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (displayName.trim().length < 2) {
      setMessage({ tone: "error", text: "Informe o nome de exibição." });
      return;
    }
    setSaving(true);
    try {
      await instancesApi.update(instance.id, {
        displayName,
        notes: notes.trim() || null,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
        version: instance.version,
      });
      setMessage({ tone: "success", text: "Alterações salvas." });
      await queryClient.invalidateQueries({ queryKey: instanceKey(instance.id) });
    } catch (caught) {
      const conflict = caught instanceof ApiError && caught.code === "CONFLICT_VERSION";
      setMessage({
        tone: "error",
        text: conflict
          ? "Outra pessoa alterou a instância. Seus textos foram mantidos; a versão atual foi carregada: salve de novo."
          : caught instanceof ApiError
            ? caught.message
            : "Ocorreu uma falha inesperada.",
      });
      if (conflict) await queryClient.invalidateQueries({ queryKey: instanceKey(instance.id) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <DescriptionList
        items={[
          {
            id: "contractor",
            term: "Contratante",
            description: (
              <Link
                to={`/contratantes/${instance.contractorId}`}
                className="underline underline-offset-4"
              >
                {instance.contractorName}
              </Link>
            ),
          },
          { id: "product", term: "Produto", description: instance.productCode },
          {
            id: "slug",
            term: "Identificador de acesso",
            description: (
              <span>
                <code>{instance.slug}</code> <Text tone="muted">(não pode ser alterado)</Text>
              </span>
            ),
          },
          { id: "timezone", term: "Fuso horário", description: instance.timezone },
          {
            id: "schema",
            term: "Versão de schema",
            description: instance.schemaVersion === null ? "—" : `v${instance.schemaVersion}`,
          },
          {
            id: "admin",
            term: "Administrador inicial",
            description: <span className="break-all">{instance.initialAdminEmail || "—"}</span>,
          },
          {
            id: "provisioning",
            term: "Provisionamento",
            description: instance.lastTask ? (
              <Link
                to={`/instancias/${instance.id}/provisionamento`}
                className="underline underline-offset-4"
              >
                {instance.lastTask.protocol}
              </Link>
            ) : (
              "—"
            ),
          },
        ]}
      />
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void save(e)}>
        {message && (
          <Alert
            tone={message.tone}
            title={message.tone === "success" ? "Salvo" : "Não foi possível salvar"}
          >
            {message.text}
          </Alert>
        )}
        <Input
          label="Nome de exibição"
          name="displayName"
          maxLength={120}
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Textarea
          label="Anotações administrativas"
          name="notes"
          maxLength={4000}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Início da vigência"
            type="date"
            name="validFrom"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
          <Input
            label="Fim da vigência"
            type="date"
            name="validUntil"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </div>
        <div>
          <Button type="submit" loading={saving}>
            Salvar
          </Button>
        </div>
      </form>
    </div>
  );
}

function Timeline({ instance }: { instance: InstanceDetail }) {
  return (
    <ListGroup
      label={`Linha do tempo de ${instance.displayName}`}
      items={instance.transitions.map((t, index) => ({
        id: `${t.at}-${index}`,
        label: `${t.from ? STATE_LABEL[t.from].label : "Início"} → ${STATE_LABEL[t.to].label}`,
        description: `${dateTime.format(new Date(t.at))} · ${t.actorName}${t.reason ? ` · ${t.reason}` : ""}`,
      }))}
    />
  );
}
