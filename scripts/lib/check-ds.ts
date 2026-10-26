export interface DsProblem {
  file: string;
  code:
    | "DS_TOKEN_REDEFINED"
    | "DS_STYLE_COPIED"
    | "DS_DEEP_IMPORT"
    | "TAILWIND_DYNAMIC_CLASS"
    | "DS_UPDATE_UNRECORDED";
  message: string;
}

const TOKEN_DEFINITION = /--color-sh-[\w-]+\s*:/;
const SH_RULE = /(^|[\s,}>+~])\.sh-[\w-]+[^{};]*\{/m;
const DS_BUNDLE_MARKER = /tailwindcss v?\d|\/\*!\s*tailwindcss/;
const DEEP_IMPORT = /["']@sparkling-hub\/design-system\/(?!styles\.css["'])[^"']+["']/;
const DYNAMIC_CLASS =
  /`[^`]*\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|shadow|decoration|accent|caret|divide|placeholder)-\$\{/;

/**
 * Verifica que a interface consome o design system só pela API pública, sem redefinir tokens,
 * copiar estilos de controles ou gerar classes Tailwind dinâmicas (princípio VIII, FR-025).
 */
export function checkSources(files: { path: string; content: string }[]): DsProblem[] {
  const problems: DsProblem[] = [];
  for (const { path, content } of files) {
    const add = (code: DsProblem["code"], message: string) =>
      problems.push({ file: path, code, message });
    if (path.endsWith(".css")) {
      if (TOKEN_DEFINITION.test(content)) {
        add("DS_TOKEN_REDEFINED", "Tokens --color-sh-* pertencem ao design system");
      }
      if (SH_RULE.test(content) || DS_BUNDLE_MARKER.test(content)) {
        add("DS_STYLE_COPIED", "Estilos .sh-* ou cópia do CSS do pacote não podem existir aqui");
      }
    }
    if (DEEP_IMPORT.test(content)) {
      add("DS_DEEP_IMPORT", "Importe apenas '@sparkling-hub/design-system' ou '/styles.css'");
    }
    if (/\.(tsx?|jsx?)$/.test(path) && DYNAMIC_CLASS.test(content)) {
      add("TAILWIND_DYNAMIC_CLASS", "Classes Tailwind devem ser estáticas");
    }
  }
  return problems;
}

/** Cada `.tgz` em vendor/design-system precisa de entrada com seu sha256 no registro. */
export function checkVendor(
  packages: { file: string; sha256: string }[],
  updatesDoc: string,
): DsProblem[] {
  return packages
    .filter(({ sha256 }) => !updatesDoc.includes(sha256))
    .map(({ file }) => ({
      file,
      code: "DS_UPDATE_UNRECORDED" as const,
      message: "Pacote sem entrada (com sha256) em docs/design-system-updates.md",
    }));
}
