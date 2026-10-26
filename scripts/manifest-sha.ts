// Uso: npx tsx scripts/manifest-sha.ts <arquivo.sql>... — imprime o sha256 normalizado (LF, sem BOM).
import { readFileSync } from "node:fs";
import { normalizeSql, sha256 } from "../server/src/platform/migrations/manifest.js";

for (const file of process.argv.slice(2)) {
  console.log(`${sha256(normalizeSql(readFileSync(file)))}  ${file}`);
}
