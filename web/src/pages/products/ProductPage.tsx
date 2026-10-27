import {
  Alert,
  Badge,
  Button,
  DescriptionList,
  Heading,
  Input,
  SettingsBlock,
  Skeleton,
  Textarea,
} from "@sparkling-hub/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/client";
import {
  type Product,
  PRODUCTS_KEY,
  productKey,
  productsApi,
  REASON_TEXT,
  useProduct,
} from "../../api/products";
import { ReasonDialog, type ReasonRequest } from "../../components/ReasonDialog";

/** `/produtos/:code` — nome e descrição editáveis; o resto é do código implantado (US2). */
export function ProductPage() {
  const { code = "" } = useParams();
  const product = useProduct(code);
  if (product.isPending) return <Skeleton label="Carregando produto" lines={5} />;
  if (product.isError) {
    const notFound = product.error instanceof ApiError && product.error.status === 404;
    return (
      <Alert tone="error" title={notFound ? "Produto não encontrado" : "Falha ao carregar"}>
        <Link to="/produtos" className="underline underline-offset-4">
          Voltar ao catálogo
        </Link>
      </Alert>
    );
  }
  return <ProductEditor product={product.data} />;
}

function ProductEditor({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [action, setAction] = useState<ReasonRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const active = product.status === "ativo";

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: productKey(product.code) });
    await queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (name.trim().length < 2) {
      setMessage({ tone: "error", text: "Informe o nome do produto." });
      return;
    }
    setSaving(true);
    try {
      await productsApi.update(product.code, { name, description, version: product.version });
      setMessage({ tone: "success", text: "Alterações salvas." });
      await refresh();
    } catch (caught) {
      setMessage({
        tone: "error",
        text:
          caught instanceof ApiError && caught.code === "CONFLICT_VERSION"
            ? "Outra pessoa alterou o produto. Seus textos foram mantidos; a versão atual foi carregada: salve de novo."
            : caught instanceof ApiError
              ? caught.message
              : "Ocorreu uma falha inesperada.",
      });
      if (caught instanceof ApiError && caught.code === "CONFLICT_VERSION") await refresh();
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = () => {
    setActionError(null);
    setAction({
      title: active ? `Inativar ${product.name}` : `Reativar ${product.name}`,
      description: active
        ? "Novas solicitações de instância serão recusadas. As instâncias existentes não mudam."
        : "O produto volta a aceitar novas solicitações, se o artefato estiver válido.",
      confirmLabel: active ? `Inativar ${product.name}` : `Reativar ${product.name}`,
      danger: active,
      onConfirm: async (reason) => {
        try {
          await productsApi.setStatus(
            product.code,
            active ? "inactivate" : "reactivate",
            reason,
            product.version,
          );
          setAction(null);
          await refresh();
        } catch (caught) {
          if (caught instanceof ApiError && caught.code === "CONFLICT_VERSION") await refresh();
          setActionError(caught instanceof ApiError ? caught.message : "Falha inesperada.");
        }
      },
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Heading level={1}>{product.name}</Heading>
          <div className="flex flex-wrap gap-2">
            {active ? <Badge tone="success">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>}
            {product.provisionable ? (
              <Badge tone="success">Provisionável</Badge>
            ) : (
              <Badge tone="warning">Não provisionável</Badge>
            )}
          </div>
        </div>
        <Button variant={active ? "danger" : "secondary"} onClick={changeStatus}>
          {active ? "Inativar" : "Reativar"}
        </Button>
      </div>

      {!product.provisionable && product.notProvisionableReason && (
        <Alert tone="info" title="Por que não é provisionável">
          {REASON_TEXT[product.notProvisionableReason]}
        </Alert>
      )}

      <SettingsBlock
        title="Dados do catálogo"
        description="Código, versões e provisionador vêm do código implantado e não são editáveis."
        aside={
          <DescriptionList
            items={[
              { id: "code", term: "Código", description: <code>{product.code}</code> },
              {
                id: "provisioner",
                term: "Provisionador",
                description: product.provisioner ?? "—",
              },
              {
                id: "deployed",
                term: "Versão implantada",
                description: product.deployedVersion === null ? "—" : `v${product.deployedVersion}`,
              },
              {
                id: "schema",
                term: "Versão de schema suportada",
                description:
                  product.supportedSchemaVersion === null
                    ? "—"
                    : `v${product.supportedSchemaVersion}`,
              },
            ]}
          />
        }
      >
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
            label="Nome"
            name="name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            label="Descrição curta"
            name="description"
            maxLength={280}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div>
            <Button type="submit" loading={saving}>
              Salvar
            </Button>
          </div>
        </form>
      </SettingsBlock>

      <ReasonDialog request={action} error={actionError} onClose={() => setAction(null)} />
    </>
  );
}
