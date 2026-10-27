import { describe, expect, it } from "vitest";
import { normalizeDocument, validateDocument } from "../../../src/modules/contractors/document.js";
import { nameKey } from "../../../src/modules/contractors/name-key.js";

describe("CPF (SC-004, research.md R-13)", () => {
  it("aceita CPF válido com ou sem pontuação e normaliza para 11 dígitos", () => {
    expect(validateDocument("fisica", "529.982.247-25")).toEqual({
      type: "cpf",
      normalized: "52998224725",
    });
    expect(validateDocument("fisica", "11144477735")).toEqual({
      type: "cpf",
      normalized: "11144477735",
    });
  });

  it("recusa dígito verificador errado, tamanho errado e sequências repetidas", () => {
    expect(validateDocument("fisica", "529.982.247-24")).toBeNull();
    expect(validateDocument("fisica", "5299822472")).toBeNull();
    expect(validateDocument("fisica", "111.111.111-11")).toBeNull();
    expect(validateDocument("fisica", "000.000.000-00")).toBeNull();
  });
});

describe("CNPJ numérico e alfanumérico", () => {
  it("aceita CNPJ numérico válido", () => {
    expect(validateDocument("juridica", "11.222.333/0001-81")).toEqual({
      type: "cnpj",
      normalized: "11222333000181",
    });
  });

  it("aceita o exemplo alfanumérico da Receita Federal (valor = código ASCII − 48)", () => {
    expect(validateDocument("juridica", "12.ABC.345/01DE-35")).toEqual({
      type: "cnpj",
      normalized: "12ABC34501DE35",
    });
    expect(validateDocument("juridica", "12abc34501de35")).toEqual({
      type: "cnpj",
      normalized: "12ABC34501DE35",
    });
  });

  it("recusa dígitos verificadores errados, letra nos verificadores e sequências repetidas", () => {
    expect(validateDocument("juridica", "11.222.333/0001-80")).toBeNull();
    expect(validateDocument("juridica", "12.ABC.345/01DE-36")).toBeNull();
    expect(validateDocument("juridica", "12.ABC.345/01DE-3A")).toBeNull();
    expect(validateDocument("juridica", "00.000.000/0000-00")).toBeNull();
    expect(validateDocument("juridica", "1122233300018")).toBeNull();
  });
});

describe("tipo de pessoa e normalização", () => {
  it("documento do tipo errado é recusado", () => {
    expect(validateDocument("fisica", "11.222.333/0001-81")).toBeNull();
    expect(validateDocument("juridica", "529.982.247-25")).toBeNull();
  });

  it("normaliza removendo pontuação e espaços e passando a maiúsculas", () => {
    expect(normalizeDocument(" 12.abc.345/01de-35 ")).toBe("12ABC34501DE35");
    expect(normalizeDocument("529 982 247-25")).toBe("52998224725");
  });
});

describe("chave de nome para homônimos (SC-005)", () => {
  it("ignora acentos, caixa, pontuação e sufixos societários", () => {
    expect(nameKey("Pet Feliz Ltda.")).toBe("pet feliz");
    expect(nameKey("PET FELIZ")).toBe("pet feliz");
    expect(nameKey("Pét  Feliz - ME")).toBe("pet feliz");
    expect(nameKey("Banho & Tosa Águia S/A")).toBe("banho tosa aguia");
    expect(nameKey("Banho e Tosa Águia S.A.")).toBe("banho e tosa aguia");
    expect(nameKey("Clínica Vet EIRELI")).toBe("clinica vet");
    expect(nameKey("Mercado EPP")).toBe("mercado");
  });
});
