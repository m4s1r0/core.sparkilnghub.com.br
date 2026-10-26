import { describe, expect, it } from "vitest";
import { checkSources, checkVendor } from "../lib/check-ds.js";

const file = (path: string, content: string) => ({ path, content });
const codes = (files: { path: string; content: string }[]) =>
  checkSources(files).map((p) => p.code);

describe("checkSources (web/src)", () => {
  it("falha ao redefinir token --color-sh-*", () => {
    expect(codes([file("web/src/styles/app.css", ":root { --color-sh-action: #000; }")])).toContain(
      "DS_TOKEN_REDEFINED",
    );
  });

  it("falha com regra CSS para seletor .sh-", () => {
    expect(codes([file("web/src/x.css", ".sh-button { color: red; }")])).toContain(
      "DS_STYLE_COPIED",
    );
  });

  it("falha com classe Tailwind interpolada", () => {
    expect(codes([file("web/src/x.tsx", "const c = `bg-${tone}-500`;")])).toContain(
      "TAILWIND_DYNAMIC_CLASS",
    );
  });

  it("falha com cópia de arquivo CSS do pacote", () => {
    expect(
      codes([file("web/src/design-system.css", "/*! tailwindcss */ .sh-theme { --x: 1 }")]),
    ).toContain("DS_STYLE_COPIED");
  });

  it("falha com import interno do pacote", () => {
    expect(
      codes([
        file(
          "web/src/x.tsx",
          'import { Button } from "@sparkling-hub/design-system/dist/index.js";',
        ),
      ]),
    ).toContain("DS_DEEP_IMPORT");
  });

  it("passa com import pela raiz e styles.css, usando tokens e .sh-theme", () => {
    expect(
      codes([
        file(
          "web/src/main.tsx",
          'import "@sparkling-hub/design-system/styles.css";\nimport { Button } from "@sparkling-hub/design-system";\n<div className="sh-theme" />',
        ),
        file(
          "web/src/styles/app.css",
          '@import "tailwindcss";\n.layout { color: var(--color-sh-ink); }',
        ),
      ]),
    ).toEqual([]);
  });
});

describe("checkVendor", () => {
  const sha = "a".repeat(64);
  it("falha se o .tgz não tiver entrada em docs/design-system-updates.md", () => {
    expect(
      checkVendor(
        [{ file: "x-0.3.0.tgz", sha256: sha }],
        "## 0.2.0\nsha256 `" + "b".repeat(64) + "`",
      )[0]?.code,
    ).toBe("DS_UPDATE_UNRECORDED");
  });

  it("passa quando o sha256 do .tgz está registrado", () => {
    expect(
      checkVendor([{ file: "x-0.2.0.tgz", sha256: sha }], `## 0.2.0\nsha256 \`${sha}\``),
    ).toEqual([]);
  });
});
