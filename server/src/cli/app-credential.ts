import {
  createAppCredential,
  listAppCredentials,
  revokeAppCredential,
} from "../modules/app-credentials/app-credentials.js";
import { loadConfig } from "../platform/config/load.js";
import { createAppContext } from "../platform/context.js";
import { PoolRegistry } from "../platform/db/pools.js";
import type { AppScope } from "../platform/http/app-credential.js";
import { isUuid } from "../platform/ids.js";
import { createLogger } from "../platform/logging/logger.js";
import { runCli } from "./run.js";

// npm run app-credential -- create <produto> <rótulo> --scopes sessions,members
// npm run app-credential -- revoke <id>
// npm run app-credential -- list
// Credenciais dos contratos internos (R-09, contracts/commands-f01.md). O segredo é exibido uma
// única vez, na criação. Permitido em todos os ambientes.
const USAGE = [
  "Uso:",
  "  npm run app-credential -- create <produto> <rótulo> --scopes sessions,members",
  "  npm run app-credential -- revoke <id>",
  "  npm run app-credential -- list",
].join("\n");

const SCOPES: readonly AppScope[] = ["sessions", "members"];

function parseScopes(args: string[]): AppScope[] {
  const index = args.indexOf("--scopes");
  const raw = index >= 0 ? args[index + 1] : undefined;
  if (!raw) throw new Error(`Informe --scopes.\n${USAGE}`);
  const scopes = raw.split(",").map((s) => s.trim());
  for (const scope of scopes) {
    if (!SCOPES.includes(scope as AppScope)) throw new Error(`Escopo inválido: ${scope}`);
  }
  return scopes as AppScope[];
}

runCli("app-credential", async () => {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !["create", "revoke", "list"].includes(command)) throw new Error(USAGE);
  const config = loadConfig({ credentials: ["migrator"] });
  const pools = new PoolRegistry(config);
  try {
    const ctx = createAppContext(config, pools, {
      role: "migrator",
      logger: createLogger({ name: "app-credential" }),
    });
    if (command === "create") {
      const [productCode, label] = args;
      if (!productCode || !/^[a-z][a-z0-9]{1,31}$/.test(productCode) || !label) {
        throw new Error(USAGE);
      }
      const created = await createAppCredential(ctx, {
        productCode,
        label: label.slice(0, 120),
        scopes: parseScopes(args),
      });
      console.log("Credencial de aplicação criada (exibida uma única vez; guarde em cofre):");
      console.log(created.value);
      return;
    }
    if (command === "revoke") {
      const [id] = args;
      if (!id || !isUuid(id)) throw new Error(USAGE);
      const revoked = await revokeAppCredential(ctx, id);
      console.log(
        revoked ? `Credencial ${id} revogada.` : `Credencial ${id} inexistente ou já revogada.`,
      );
      return;
    }
    const items = await listAppCredentials(ctx);
    if (items.length === 0) console.log("Nenhuma credencial de aplicação.");
    for (const item of items) {
      const state = item.revokedAt
        ? `revogada em ${item.revokedAt.toISOString()}`
        : item.expiresAt && item.expiresAt <= new Date()
          ? "vencida"
          : "ativa";
      console.log(
        `${item.id}  ${item.productCode}  [${item.scopes.join(",")}]  ${state}  ${item.label}` +
          (item.lastUsedAt ? `  último uso ${item.lastUsedAt.toISOString()}` : ""),
      );
    }
  } finally {
    await pools.closeAll();
  }
});
