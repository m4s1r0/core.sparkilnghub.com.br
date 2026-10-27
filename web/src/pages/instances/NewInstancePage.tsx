import {
  Alert,
  Button,
  Card,
  DescriptionList,
  Heading,
  Input,
  Select,
  Stepper,
  Text,
  Textarea,
} from "@sparkling-hub/design-system";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError, requestJson } from "../../api/client";
import type { ContractorSummary, PageInfo } from "../../api/contractors";
import {
  type InstancePreview,
  type InstanceRequest,
  instancesApi,
  useTimezones,
} from "../../api/instances";
import { REASON_TEXT, useProducts } from "../../api/products";
import { useReauth } from "../../components/ReauthDialog";

type StepId = "origem" | "dados" | "revisao";

/** Contratantes ativos para o passo 1 (a interface 0.2.0 não tem seleção com busca). */
function useActiveContractors() {
  return useQuery({
    queryKey: ["contractors", "ativos"],
    queryFn: () =>
      requestJson<{ items: ContractorSummary[]; pageInfo: PageInfo }>(
        "GET",
        "/api/v1/contractors?status=ativo&pageSize=100",
      ),
  });
}

const FIELD_OF: Record<string, keyof InstanceRequest> = {
  "/contractorId": "contractorId",
  "/productCode": "productCode",
  "/displayName": "displayName",
  "/slug": "slug",
  "/timezone": "timezone",
  "/initialAdminEmail": "initialAdminEmail",
  "/notes": "notes",
  "/validFrom": "validFrom",
  "/validUntil": "validUntil",
};

/** `/instancias/nova` — criação guiada em 3 passos (US3, contracts/ui-f02.md). */
export function NewInstancePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const contractors = useActiveContractors();
  const products = useProducts();
  const timezones = useTimezones();
  const reauth = useReauth();
  const [step, setStep] = useState<StepId>("origem");
  const [form, setForm] = useState<InstanceRequest>({
    contractorId: params.get("contratante") ?? "",
    productCode: "",
    displayName: "",
    slug: "",
    timezone: "America/Sao_Paulo",
    initialAdminEmail: "",
    notes: null,
    validFrom: null,
    validUntil: null,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof InstanceRequest, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [preview, setPreview] = useState<InstancePreview | null>(null);
  const [busy, setBusy] = useState(false);
  // Uma chave por solicitação: reenvio após timeout repete a mesma (COM-026, T-15).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const set = <K extends keyof InstanceRequest>(key: K, value: InstanceRequest[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setPreview(null);
  };

  const fail = (caught: unknown) => {
    const field = caught instanceof ApiError && caught.field ? FIELD_OF[caught.field] : undefined;
    if (caught instanceof ApiError && field) {
      setErrors({ [field]: caught.message });
      setStep(field === "contractorId" || field === "productCode" ? "origem" : "dados");
      return;
    }
    setFailure(caught instanceof ApiError ? caught.message : "Ocorreu uma falha inesperada.");
  };

  const toReview = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const found: typeof errors = {};
    if (form.displayName.trim().length < 2) found.displayName = "Informe o nome de exibição.";
    if (!form.slug.trim()) found.slug = "Informe o identificador de acesso.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.initialAdminEmail.trim())) {
      found.initialAdminEmail = "E-mail inválido.";
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const result = await instancesApi.preview(form);
      if (!result.slugAvailable) {
        setErrors({ slug: `O identificador "${result.slug}" já está em uso. Escolha outro.` });
        return;
      }
      setPreview(result);
      setStep("revisao");
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setFailure(null);
    setBusy(true);
    try {
      const created = await reauth.run(() => instancesApi.request(form, idempotencyKey));
      void navigate(`/instancias/${created.instance.id}/provisionamento`, {
        state: { protocol: created.task.protocol },
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "AUTH_REAUTH_REQUIRED") return;
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const contractorOptions = (contractors.data?.items ?? []).map((c) => ({
    value: c.id,
    label: c.displayName,
  }));
  const productOptions = (products.data?.items ?? []).map((p) => ({
    value: p.code,
    label:
      p.provisionable || !p.notProvisionableReason
        ? p.name
        : `${p.name} — ${REASON_TEXT[p.notProvisionableReason]}`,
    disabled: !p.provisionable,
  }));
  const err = (key: keyof InstanceRequest) => (errors[key] ? { error: errors[key] } : {});

  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Nova instância</Heading>
        <Text tone="muted">
          A instância ficará pronta para uso depois do provisionamento; a ativação é uma etapa
          posterior.
        </Text>
      </div>
      <Stepper
        label="Passos da solicitação"
        currentId={step}
        steps={[
          { id: "origem", title: "Contratante e produto", completed: step !== "origem" },
          { id: "dados", title: "Dados da instância", completed: step === "revisao" },
          { id: "revisao", title: "Revisão e confirmação", disabled: !preview },
        ]}
        onStepChange={(id) => {
          if (id !== "revisao" || preview) setStep(id as StepId);
        }}
      />
      {failure && (
        <Alert tone="error" title="Não foi possível continuar">
          {failure}
        </Alert>
      )}

      {step === "origem" && (
        <Card title="Contratante e produto">
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const found: typeof errors = {};
              if (!form.contractorId) found.contractorId = "Escolha o contratante.";
              if (!form.productCode) found.productCode = "Escolha um produto provisionável.";
              setErrors(found);
              if (Object.keys(found).length === 0) setStep("dados");
            }}
          >
            {contractors.isSuccess && contractorOptions.length === 0 && (
              <Alert tone="info" title="Nenhum contratante ativo">
                <Link to="/contratantes/novo" className="underline underline-offset-4">
                  Cadastre um contratante
                </Link>{" "}
                antes de solicitar a instância.
              </Alert>
            )}
            <Select
              label="Contratante"
              name="contractorId"
              placeholder={contractors.isPending ? "Carregando…" : "Escolha"}
              options={contractorOptions}
              value={form.contractorId}
              onChange={(e) => set("contractorId", e.target.value)}
              {...err("contractorId")}
            />
            <Select
              label="Produto"
              name="productCode"
              hint="Produtos sem artefato publicado aparecem indisponíveis, com o motivo."
              placeholder={products.isPending ? "Carregando…" : "Escolha"}
              options={productOptions}
              value={form.productCode}
              onChange={(e) => set("productCode", e.target.value)}
              {...err("productCode")}
            />
            <div>
              <Button type="submit">Continuar</Button>
            </div>
          </form>
        </Card>
      )}

      {step === "dados" && (
        <Card title="Dados da instância">
          <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void toReview(e)}>
            <Input
              label="Nome de exibição"
              name="displayName"
              maxLength={120}
              required
              value={form.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              {...err("displayName")}
            />
            <Input
              label="Identificador de acesso"
              name="slug"
              hint="Usado no endereço da instância. Não poderá ser alterado depois; o valor final aparece na revisão."
              maxLength={80}
              required
              value={form.slug}
              onChange={(e) => set("slug", e.target.value)}
              {...err("slug")}
            />
            <Select
              label="Fuso horário"
              name="timezone"
              options={(timezones.data?.items ?? [form.timezone]).map((zone) => ({
                value: zone,
                label: zone.replace("America/", "").replaceAll("_", " "),
              }))}
              value={form.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              {...err("timezone")}
            />
            <Input
              label="E-mail do administrador inicial"
              type="email"
              name="initialAdminEmail"
              hint="Recebe o convite inicial; o link é emitido depois que a instância ficar pronta."
              maxLength={254}
              required
              value={form.initialAdminEmail}
              onChange={(e) => set("initialAdminEmail", e.target.value)}
              {...err("initialAdminEmail")}
            />
            <Textarea
              label="Anotações (opcional)"
              name="notes"
              maxLength={4000}
              rows={3}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value || null)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Início da vigência (opcional)"
                type="date"
                name="validFrom"
                value={form.validFrom ?? ""}
                onChange={(e) => set("validFrom", e.target.value || null)}
                {...err("validFrom")}
              />
              <Input
                label="Fim da vigência (opcional)"
                type="date"
                name="validUntil"
                value={form.validUntil ?? ""}
                onChange={(e) => set("validUntil", e.target.value || null)}
                {...err("validUntil")}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy}>
                Revisar
              </Button>
              <Button variant="secondary" onClick={() => setStep("origem")}>
                Voltar
              </Button>
            </div>
          </form>
        </Card>
      )}

      {step === "revisao" && preview && (
        <Card title="Revisão">
          <div className="flex flex-col gap-4">
            <DescriptionList
              items={[
                {
                  id: "contractor",
                  term: "Contratante",
                  description: preview.contractor.displayName,
                },
                { id: "product", term: "Produto", description: preview.product.name },
                { id: "name", term: "Nome de exibição", description: form.displayName },
                {
                  id: "slug",
                  term: "Identificador de acesso",
                  description: (
                    <span>
                      <code>{preview.slug}</code>
                      {preview.slug !== form.slug.trim() && (
                        <Text tone="muted"> (normalizado de “{form.slug.trim()}”)</Text>
                      )}
                    </span>
                  ),
                },
                { id: "timezone", term: "Fuso horário", description: preview.timezone },
                {
                  id: "email",
                  term: "Administrador inicial",
                  description: <span className="break-all">{preview.initialAdminEmail}</span>,
                },
              ]}
            />
            <Text tone="muted">
              Nenhuma credencial é exibida. Confirmar pede o código do aplicativo autenticador se a
              última confirmação tiver mais de 5 minutos.
            </Text>
            <div className="flex flex-wrap gap-2">
              <Button loading={busy} onClick={() => void confirm()}>
                Confirmar e solicitar
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setStep("dados")}>
                Voltar
              </Button>
            </div>
          </div>
        </Card>
      )}
      {reauth.dialog}
    </>
  );
}
