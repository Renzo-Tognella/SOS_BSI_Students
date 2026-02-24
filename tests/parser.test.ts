import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseHistoricoText } from "@/lib/parser/historico-parser";

describe("historico parser", () => {
  const fixturePath = path.join(process.cwd(), "tests/fixtures/historico-sample.txt");
  const raw = readFileSync(fixturePath, "utf8");

  it("extracts matrix, student and attempts", () => {
    const parsed = parseHistoricoText(raw);

    expect(parsed.detectedMatrixCode).toBe("981");
    expect(parsed.student.registrationId).toBe("2413949");
    expect(parsed.student.courseCode).toBe("236");
    expect(parsed.attempts.length).toBeGreaterThan(5);
  });

  it("normalizes approved and failed status", () => {
    const parsed = parseHistoricoText(raw);
    const approved = parsed.attempts.find((attempt) => attempt.code === "ICSF13");
    const failed = parsed.attempts.find((attempt) => attempt.code === "ICSD21" && attempt.status === "FAILED");

    expect(approved?.status).toBe("APPROVED");
    expect(failed?.status).toBe("FAILED");
  });

  it("does not merge adjacent lines into discipline name", () => {
    const parsed = parseHistoricoText(raw);
    const integration = parsed.attempts.find((attempt) => attempt.code === "ICSX20");

    expect(integration?.name.toLowerCase()).toContain("trabalho");
    expect(integration?.name.toLowerCase()).not.toContain("mariangela");
    expect(integration?.name.toLowerCase()).not.toContain("professor");
  });

  it("parses explicit missing and summary", () => {
    const parsed = parseHistoricoText(raw);

    expect(parsed.explicitMissing.map((item) => item.code)).toContain("FCH7FA");
    expect(parsed.summary.some((row) => row.key.includes("Obrigatórias"))).toBe(true);
    expect(parsed.extensionSummary.some((row) => row.key.includes("geral"))).toBe(true);
  });

  it("recognizes matrix 962 from transcript header", () => {
    const minimalHeader = [
      "Aluno: 999999 - Aluno Teste Identidade",
      "Curso: 212 - Engenharia de Computação Período: 1",
      "Ingresso: 2024/1 Data da colação",
      "Matriz: 962 - Matriz Curricular",
      "Disciplinas Obrigatórias"
    ].join("\n");

    const parsed = parseHistoricoText(minimalHeader);
    expect(parsed.detectedMatrixCode).toBe("962");
  });
});
