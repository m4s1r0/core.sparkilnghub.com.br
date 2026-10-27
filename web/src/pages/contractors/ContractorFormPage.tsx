import {
  Alert,
  Button,
  Card,
  Collapse,
  Heading,
  Input,
  RadioGroup,
  Select,
  Skeleton,
  Text,
} from "@sparkling-hub/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../../api/client";
import {
  type Address,
  type ContractorInput,
  contractorKey,
  contractorsApi,
  formatDocument,
  type PersonType,
  type SimilarContractor,
  useContractor,
} from "../../api/contractors";

const UFS =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const UF_OPTIONS = [{ value: "", label: "—" }, ...UFS.map((uf) => ({ value: uf, label: uf }))];
const PERSON_OPTIONS = [
  { value: "juridica", label: "Pessoa jurídica" },
  { value: "fisica", label: "Pessoa física" },
];

interface FormState {
  legalName: string;
  displayName: string;
  personType: PersonType;
  document: string;
  contactName: string;
  email: string;
  phone: string;
  address: Required<Address>;
}

const EMPTY_ADDRESS: Required<Address> = {
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
};

const EMPTY: FormState = {
  legalName: "",
  displayName: "",
  personType: "juridica",
  document: "",
  contactName: "",
  email: "",
  phone: "",
  address: EMPTY_ADDRESS,
};

/** Ponteiro JSON do erro do servidor → campo do formulário. */
const FIELD_OF: Record<string, string> = {
  "/legalName": "legalName",
  "/displayName": "displayName",
  "/document": "document",
  "/contactName": "contactName",
  "/email": "email",
  "/phone": "phone",
  "/address/cep": "cep",
  "/address/uf": "uf",
};

function toInput(form: FormState): ContractorInput {
  const address = Object.fromEntries(
    Object.entries(form.address).filter(([, value]) => value.trim() !== ""),
  ) as Address;
  if (address.cep) address.cep = address.cep.replace(/\D/g, "");
  return {
    legalName: form.legalName.trim(),
    displayName: form.displayName.trim(),
    personType: form.personType,
    document: form.document.trim() || null,
    contactName: form.contactName.trim(),
    email: form.email.trim(),
    phone: form.phone.trim() || null,
    address: Object.keys(address).length > 0 ? address : null,
  };
}

/** Validação de apoio na interface; a autoritativa é do servidor (constituição VIII). */
function localErrors(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.legalName.trim().length < 2) errors.legalName = "Informe o nome ou a razão social.";
  if (form.displayName.trim().length < 2) errors.displayName = "Informe o nome de exibição.";
  if (form.contactName.trim().length < 2) errors.contactName = "Informe o contato responsável.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "E-mail inválido.";
  if (form.address.cep && form.address.cep.replace(/\D/g, "").length !== 8) {
    errors.cep = "CEP com 8 dígitos.";
  }
  return errors;
}

/** `/contratantes/novo` e `/contratantes/:id/editar` (US1, contracts/ui-f02.md). */
export function ContractorFormPage() {
  const { id } = useParams();
  return id ? <EditContractor id={id} /> : <ContractorForm initial={EMPTY} />;
}

function EditContractor({ id }: { id: string }) {
  const contractor = useContractor(id);
  if (contractor.isPending) return <Skeleton label="Carregando contratante" lines={6} />;
  if (contractor.isError) {
    return (
      <Alert tone="error" title="Não foi possível carregar o contratante">
        {contractor.error instanceof ApiError ? contractor.error.message : "Falha inesperada."}
      </Alert>
    );
  }
  const c = contractor.data;
  return (
    <ContractorForm
      id={id}
      version={c.version}
      initial={{
        legalName: c.legalName,
        displayName: c.displayName,
        personType: c.personType,
        document: c.document ? formatDocument(c.document) : "",
        contactName: c.contactName,
        email: c.email,
        phone: c.phone ?? "",
        address: { ...EMPTY_ADDRESS, ...(c.address ?? {}) },
      }}
    />
  );
}

function ContractorForm({
  id,
  version: initialVersion,
  initial,
}: {
  id?: string;
  version?: number;
  initial: FormState;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(initial);
  const [version, setVersion] = useState(initialVersion ?? 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const [similar, setSimilar] = useState<SimilarContractor[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Uma chave por formulário: reenvio após timeout repete a mesma criação (COM-026).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const setAddress = (key: keyof Address, value: string) =>
    setForm((current) => ({ ...current, address: { ...current.address, [key]: value } }));

  const fail = (caught: unknown) => {
    if (!(caught instanceof ApiError)) {
      setFailure({ title: "Não foi possível salvar", message: "Ocorreu uma falha inesperada." });
      return;
    }
    if (caught.code === "CONFLICT_DOCUMENT_TAKEN") {
      setErrors({ document: caught.message });
      const first = caught.details[0];
      setExisting(first ? { id: first.code, name: first.message } : null);
      return;
    }
    if (caught.code === "CONFLICT_VERSION" && id) {
      setFailure({
        title: "Outra pessoa alterou este contratante",
        message:
          "Seus dados digitados foram mantidos. A versão atual foi carregada: revise e salve de novo.",
      });
      // Só a versão é atualizada; o formulário mantém o que foi digitado (COM-027).
      void queryClient
        .fetchQuery({
          queryKey: contractorKey(id),
          queryFn: () => contractorsApi.get(id),
          staleTime: 0,
        })
        .then((latest) => setVersion(latest.version))
        .catch(() => undefined);
      return;
    }
    const field = caught.field ? FIELD_OF[caught.field] : undefined;
    if (field) setErrors({ [field]: caught.message });
    else setFailure({ title: "Não foi possível salvar", message: caught.message });
  };

  const save = async (confirmedSimilar: boolean) => {
    setFailure(null);
    setExisting(null);
    const found = localErrors(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    try {
      if (!id && !confirmedSimilar) {
        const { items } = await contractorsApi.similar(form.legalName, form.document);
        if (items.length > 0) {
          setSimilar(items);
          return;
        }
      }
      const saved = id
        ? await contractorsApi.update(id, { ...toInput(form), version })
        : await contractorsApi.create(toInput(form), idempotencyKey);
      await queryClient.invalidateQueries({ queryKey: ["contractors"] });
      queryClient.removeQueries({ queryKey: contractorKey(saved.id) });
      void navigate(`/contratantes/${saved.id}`);
    } catch (caught) {
      fail(caught);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSimilar(null);
    void save(false);
  };

  const err = (key: string) => (errors[key] ? { error: errors[key] } : {});

  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>{id ? "Editar contratante" : "Novo contratante"}</Heading>
        <Text tone="muted">
          Documento e endereço são opcionais. O e-mail de contato pode se repetir entre
          contratantes.
        </Text>
      </div>

      {failure && (
        <Alert tone="error" title={failure.title}>
          {failure.message}
        </Alert>
      )}

      {similar && (
        <Alert tone="warning" title="Possíveis contratantes já cadastrados">
          <p>Confira antes de criar. Nada é unido automaticamente.</p>
          <ul className="my-2 flex flex-col gap-1">
            {similar.map((item) => (
              <li key={item.id}>
                <Link to={`/contratantes/${item.id}`} className="underline underline-offset-4">
                  {item.displayName}
                </Link>{" "}
                — {item.legalName} · {formatDocument(item.document)} ·{" "}
                {item.match === "documento" ? "mesmo documento" : "nome parecido"}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button loading={submitting} onClick={() => void save(true)}>
              Continuar mesmo assim
            </Button>
            <Button variant="secondary" onClick={() => setSimilar(null)}>
              Revisar dados
            </Button>
          </div>
        </Alert>
      )}

      <Card title="Dados do contratante">
        <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
          <RadioGroup
            label="Tipo"
            name="personType"
            options={PERSON_OPTIONS}
            value={form.personType}
            onValueChange={(value) => set("personType", value as PersonType)}
          />
          <Input
            label={form.personType === "juridica" ? "Razão social" : "Nome completo"}
            name="legalName"
            required
            maxLength={200}
            value={form.legalName}
            onChange={(e) => set("legalName", e.target.value)}
            {...err("legalName")}
          />
          <Input
            label="Nome de exibição"
            name="displayName"
            required
            maxLength={120}
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            {...err("displayName")}
          />
          <Input
            label={form.personType === "juridica" ? "CNPJ (opcional)" : "CPF (opcional)"}
            name="document"
            hint={
              form.personType === "juridica"
                ? "Aceita o formato numérico e o alfanumérico."
                : "Somente números ou com pontuação."
            }
            autoComplete="off"
            maxLength={18}
            value={form.document}
            onChange={(e) => set("document", e.target.value)}
            {...err("document")}
          />
          {existing && (
            <Text>
              Já pertence a{" "}
              <Link to={`/contratantes/${existing.id}`} className="underline underline-offset-4">
                {existing.name}
              </Link>
              .
            </Text>
          )}
          <Input
            label="Contato responsável"
            name="contactName"
            required
            maxLength={120}
            value={form.contactName}
            onChange={(e) => set("contactName", e.target.value)}
            {...err("contactName")}
          />
          <Input
            label="E-mail"
            type="email"
            name="email"
            required
            maxLength={254}
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            {...err("email")}
          />
          <Input
            label="Telefone (opcional)"
            type="tel"
            name="phone"
            hint="Com DDD."
            maxLength={20}
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            {...err("phone")}
          />
          <Collapse label="Endereço (opcional)" defaultOpen={Boolean(form.address.cidade)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="CEP"
                name="cep"
                inputMode="numeric"
                maxLength={9}
                value={form.address.cep}
                onChange={(e) => setAddress("cep", e.target.value)}
                {...err("cep")}
              />
              <Input
                label="Logradouro"
                name="logradouro"
                maxLength={120}
                value={form.address.logradouro}
                onChange={(e) => setAddress("logradouro", e.target.value)}
              />
              <Input
                label="Número"
                name="numero"
                maxLength={20}
                value={form.address.numero}
                onChange={(e) => setAddress("numero", e.target.value)}
              />
              <Input
                label="Complemento"
                name="complemento"
                maxLength={60}
                value={form.address.complemento}
                onChange={(e) => setAddress("complemento", e.target.value)}
              />
              <Input
                label="Bairro"
                name="bairro"
                maxLength={80}
                value={form.address.bairro}
                onChange={(e) => setAddress("bairro", e.target.value)}
              />
              <Input
                label="Cidade"
                name="cidade"
                maxLength={80}
                value={form.address.cidade}
                onChange={(e) => setAddress("cidade", e.target.value)}
              />
              <Select
                label="UF"
                name="uf"
                options={UF_OPTIONS}
                value={form.address.uf}
                onChange={(e) => setAddress("uf", e.target.value)}
                {...err("uf")}
              />
            </div>
          </Collapse>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={submitting}>
              {id ? "Salvar alterações" : "Cadastrar contratante"}
            </Button>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => void navigate(id ? `/contratantes/${id}` : "/contratantes")}
            >
              Cancelar
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
