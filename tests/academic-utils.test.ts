import { describe, expect, it } from "vitest";

import { disciplineNamesLikelyMatch, isAdministrativeAcademicCredit, normalizeStatus } from "@/lib/utils/academic";

describe("academic utils", () => {
  it("matches discipline names by normalized tokens", () => {
    expect(disciplineNamesLikelyMatch("Teorias Organizacionais", "Teorias Organizacionais")).toBe(true);
    expect(disciplineNamesLikelyMatch("Trabalho de Integração 2", "Trabalho De Integracao 2")).toBe(true);
    expect(disciplineNamesLikelyMatch("Sistemas Distribuídos", "Banco de Dados")).toBe(false);
  });

  it("infers approved status when status text is incomplete but grade/frequency are valid", () => {
    expect(normalizeStatus("registro sem situação explícita", { average: 7.1, frequency: 84 })).toBe("APPROVED");
    expect(normalizeStatus("registro sem situação explícita", { average: 4.2, frequency: 90 })).toBe("FAILED");
  });

  it("detects administrative credit entries for CHS pace filtering", () => {
    expect(isAdministrativeAcademicCredit("Crédito Consignado >> Mudança de Matriz - Cursou Disciplina(s) Equivalente(s)")).toBe(
      true
    );
    expect(isAdministrativeAcademicCredit("Aprovado por Nota/Frequência")).toBe(false);
  });

  it("prioritizes convalidation + valid metrics when status text is mixed with adjacent failure text", () => {
    expect(
      normalizeStatus(">> Mudança de Matriz - Cursou Disciplina(s) Equivalente(s) Reprovado Por Nota/Frequência", {
        average: 9.9,
        frequency: 77.8
      })
    ).toBe("APPROVED");
    expect(normalizeStatus("Cancelado", { average: 10, frequency: 84.2 })).toBe("CANCELED");
  });

  it("uses metrics to resolve mixed approved/failed text without convalidation", () => {
    expect(
      normalizeStatus("Aprovado por Nota/Frequência Reprovado Por Nota/Frequência", {
        average: 4.3,
        frequency: 92
      })
    ).toBe("FAILED");

    expect(
      normalizeStatus("Aprovado por Nota/Frequência Reprovado Por Nota/Frequência", {
        average: 7.1,
        frequency: 92
      })
    ).toBe("APPROVED");
  });
});
