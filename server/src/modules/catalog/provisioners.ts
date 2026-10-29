import type { Env } from "../../platform/config/schema.js";
import { sha256Hex } from "../../platform/crypto/index.js";
import { validateArtifact } from "../../platform/migrations/artifact-validator.js";
import { type LoadedManifest, loadManifest } from "../../platform/migrations/manifest.js";
import { referenceProductDir, tuteliProductDir } from "../../platform/paths.js";

/** Provisionador publicado com o código implantado do Core (research.md R-14). */
export interface ProvisionerDef {
  id: string;
  /** Diretório do artefato de migração do produto; nunca vem da interface (SC-009). */
  artifactDir: string;
  environments: readonly Env[];
}

export type ProvisionerRegistry = Readonly<Record<string, ProvisionerDef>>;

/**
 * Registro em código: cadastrar produto pela interface não cria provisionador (SC-008). O
 * produto de referência só existe fora de produção (constituição III); o artefato do Tuteli
 * vem de `produtos/tuteli/artifact` (contracts/migration-artifact.md).
 */
export const PROVISIONERS: ProvisionerRegistry = {
  sparkref: {
    id: "sparkref-v1",
    artifactDir: referenceProductDir,
    environments: ["development", "homologation"],
  },
  // Código do produto é imutável (SC-007); o nome comercial "Tuteli" não altera `sparkpet`.
  sparkpet: {
    id: "sparkpet-v1",
    artifactDir: tuteliProductDir,
    environments: ["development", "homologation", "production"],
  },
};

export type NotProvisionableReason =
  "SEM_PROVISIONADOR" | "ARTEFATO_INVALIDO" | "PRODUTO_INATIVO" | "AMBIENTE_NAO_PERMITIDO";

export type ResolvedProvisioner =
  | {
      ok: true;
      provisioner: ProvisionerDef;
      manifest: LoadedManifest;
      version: number;
      /** Resumo do manifesto, fixado na tarefa para detectar artefato trocado (R-07). */
      manifestSha256: string;
    }
  | { ok: false; reason: Exclude<NotProvisionableReason, "PRODUTO_INATIVO"> };

/** Resumo estável do manifesto (versões e checksums de cada arquivo). */
export const manifestDigest = (manifest: LoadedManifest) =>
  sha256Hex(JSON.stringify(manifest.manifest));

/**
 * Provisionador do produto, se existir, for permitido no ambiente e o artefato for válido
 * (manifesto, checksums, construções proibidas). O motivo da recusa é um código seguro: nunca
 * caminho de arquivo nem SQL.
 */
export async function resolveProvisioner(
  productCode: string,
  environment: Env,
  registry: ProvisionerRegistry = PROVISIONERS,
): Promise<ResolvedProvisioner> {
  const provisioner = registry[productCode];
  if (!provisioner) return { ok: false, reason: "SEM_PROVISIONADOR" };
  if (!provisioner.environments.includes(environment)) {
    return { ok: false, reason: "AMBIENTE_NAO_PERMITIDO" };
  }
  try {
    const manifest = await loadManifest(provisioner.artifactDir);
    validateArtifact(manifest);
    if (manifest.artifact !== productCode) return { ok: false, reason: "ARTEFATO_INVALIDO" };
    return {
      ok: true,
      provisioner,
      manifest,
      version: manifest.migrations.length,
      manifestSha256: manifestDigest(manifest),
    };
  } catch {
    return { ok: false, reason: "ARTEFATO_INVALIDO" };
  }
}
