// npm run gate -- <fatia> — saída 0 se as decisões exigidas em docs/slices.yaml estão confirmadas,
// 3 se não (listando-as). Sem argumento: verificação global de fatias `pronta` ou posteriores.
import { checkAllSlices, checkSlice, loadDecisions, loadSlices } from "./lib/gate.js";
import { repoRoot } from "./lib/repo.js";

const slices = loadSlices(repoRoot);
const decisions = loadDecisions(repoRoot);
const target = process.argv[2];

if (target) {
  const slice = slices.find((s) => s.id === target);
  if (!slice) {
    console.error(
      `Fatia desconhecida: ${target} (conhecidas: ${slices.map((s) => s.id).join(", ")})`,
    );
    process.exit(1);
  }
  const { exitCode, pending } = checkSlice(slice, decisions);
  if (exitCode !== 0) {
    console.error(`${target} bloqueada: decisões não confirmadas → ${pending.join(", ")}`);
  } else {
    console.log(
      `${target} liberada: decisões exigidas confirmadas (${slice.requires.join(", ") || "nenhuma"})`,
    );
  }
  process.exit(exitCode);
}

const { exitCode, violations } = checkAllSlices(slices, decisions);
for (const v of violations) {
  console.error(`${v.slice} está "${v.status}" com decisões pendentes: ${v.pending.join(", ")}`);
}
if (exitCode === 0) console.log(`gate ok: ${slices.length} fatia(s) coerentes com as decisões`);
process.exit(exitCode);
