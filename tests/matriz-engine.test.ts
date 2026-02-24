import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { calculateRoadmap } from "@/lib/domain/matriz-engine";
import { parseHistoricoText } from "@/lib/parser/historico-parser";
import type { ParsedTranscript } from "@/types/academic";

describe("matriz engine", () => {
  const fixturePath = path.join(process.cwd(), "tests/fixtures/historico-sample.txt");
  const raw = readFileSync(fixturePath, "utf8");

  it("computes progress and pending disciplines", async () => {
    const parsed = parseHistoricoText(raw);
    const roadmap = await calculateRoadmap(parsed, "981");

    expect(roadmap.matrixCode).toBe("981");
    expect(roadmap.progress.length).toBeGreaterThan(5);
    expect(roadmap.pending.some((discipline) => discipline.code === "FCH7FA")).toBe(true);
    expect(roadmap.pending.some((discipline) => discipline.code === "ICSS30")).toBe(true);
    const electivePending = roadmap.pending.filter((discipline) => discipline.category === "ELECTIVE");
    expect(electivePending.length).toBeGreaterThan(0);
    expect(electivePending.every((discipline) => discipline.code.startsWith("ELVP"))).toBe(true);
    expect(electivePending.reduce((sum, discipline) => sum + discipline.cht, 0)).toBe(105);
    expect((roadmap.electiveOptions ?? []).length).toBeGreaterThan(0);
    expect((roadmap.electiveOptions ?? []).some((discipline) => discipline.code === "ELEW40")).toBe(true);
  });

  it("keeps only approved attempt as completed", async () => {
    const parsed = parseHistoricoText(raw);
    const roadmap = await calculateRoadmap(parsed, "981");

    const discreteNode = roadmap.prereqGraph.nodes.find((node) => node.code === "ICSD21");
    expect(discreteNode?.status).toBe("DONE");
  });

  it("returns graph and unused list structures", async () => {
    const parsed = parseHistoricoText(raw);
    const roadmap = await calculateRoadmap(parsed, "981");

    expect(roadmap.prereqGraph.nodes.length).toBeGreaterThan(10);
    expect(Array.isArray(roadmap.unusedDisciplines)).toBe(true);
  });

  it("applies fallback matching by discipline name when code does not match matrix", async () => {
    const parsed: ParsedTranscript = {
      parserVersion: "test",
      generatedAt: new Date().toISOString(),
      rawText: "",
      student: {
        registrationId: "999999",
        fullName: "Teste Nome Fallback"
      },
      detectedMatrixCode: "981",
      matrixLabel: "Matriz 981",
      attempts: [
        {
          sourceSection: "mandatory",
          code: "XTRB22",
          name: "Trabalho de Integração 2",
          cht: 45,
          chext: 0,
          status: "APPROVED",
          statusText: "Aprovado Por Nota/Frequência",
          rawBlock: "dummy"
        }
      ],
      explicitMissing: [],
      dependencies: [],
      summary: [],
      extensionSummary: [],
      unparsedBlocks: [],
      warnings: []
    };

    const roadmap = await calculateRoadmap(parsed, "981");
    expect(roadmap.pending.some((discipline) => discipline.code === "ICSX30")).toBe(false);
    expect(roadmap.alerts.some((alert) => alert.includes("Fallback por nome aplicado"))).toBe(true);
  });

  it("maps approved discipline by name when code changes across matrices", async () => {
    const parsed: ParsedTranscript = {
      parserVersion: "test",
      generatedAt: new Date().toISOString(),
      rawText: "",
      student: {
        registrationId: "999998",
        fullName: "Teste Código Diferente Mesmo Nome"
      },
      detectedMatrixCode: "806",
      matrixLabel: "Matriz 806",
      attempts: [
        {
          sourceSection: "mandatory",
          code: "ICSD20",
          name: "Introdução à Lógica para Computação",
          cht: 54,
          chext: 0,
          status: "APPROVED",
          statusText: "Aprovado Por Nota/Frequência",
          rawBlock: "dummy"
        }
      ],
      explicitMissing: [],
      dependencies: [],
      summary: [],
      extensionSummary: [],
      unparsedBlocks: [],
      warnings: []
    };

    const roadmap = await calculateRoadmap(parsed, "806");
    expect(roadmap.pending.some((discipline) => discipline.code === "CSD20")).toBe(false);
    expect(roadmap.unusedDisciplines.some((discipline) => discipline.code === "ICSD20")).toBe(false);
    expect(roadmap.alerts.some((alert) => alert.includes("ICSD20->CSD20"))).toBe(true);
  });

  it("applies approved convalidation markers from raw transcript text", async () => {
    const parsed: ParsedTranscript = {
      parserVersion: "test",
      generatedAt: new Date().toISOString(),
      rawText:
        "Crédito Consignado [disciplina FCH7PA - Fechamento de Turmas - Cursou Disciplina(s) Equivalente(s)] Aprovado Por Nota/Frequência",
      student: {
        registrationId: "999999",
        fullName: "Teste Convalidação"
      },
      detectedMatrixCode: "981",
      matrixLabel: "Matriz 981",
      attempts: [
        {
          sourceSection: "mandatory",
          code: "FCH7PA",
          name: "Psicologia do Trabalho",
          cht: 30,
          chext: 0,
          status: "CANCELED",
          statusText: "Cancelado",
          rawBlock: "dummy"
        }
      ],
      explicitMissing: [],
      dependencies: [],
      summary: [],
      extensionSummary: [],
      unparsedBlocks: [],
      warnings: []
    };

    const roadmap = await calculateRoadmap(parsed, "981");
    expect(roadmap.pending.some((discipline) => discipline.code === "FCH7PA")).toBe(false);
    expect(roadmap.alerts.some((alert) => alert.includes("Convalidações aprovadas detectadas"))).toBe(true);
  });

  it("applies manual correlation and removes discipline from pending", async () => {
    const parsed: ParsedTranscript = {
      parserVersion: "test",
      generatedAt: new Date().toISOString(),
      rawText: "",
      student: {
        registrationId: "111111",
        fullName: "Teste Correlação Manual"
      },
      detectedMatrixCode: "981",
      matrixLabel: "Matriz 981",
      attempts: [
        {
          sourceSection: "mandatory",
          code: "ZZZ999",
          name: "Disciplina Externa Sem Match Automático",
          cht: 45,
          chext: 0,
          status: "APPROVED",
          statusText: "Aprovado Por Nota/Frequência",
          rawBlock: "dummy"
        }
      ],
      explicitMissing: [],
      dependencies: [],
      summary: [],
      extensionSummary: [],
      unparsedBlocks: [],
      warnings: []
    };

    const targetCode = "FCH7HA";
    const withoutManual = await calculateRoadmap(parsed, "981");
    expect(withoutManual.pending.some((discipline) => discipline.code === targetCode)).toBe(true);

    const withManual = await calculateRoadmap(parsed, "981", [{ sourceCode: "ZZZ999", targetCode }]);
    expect(withManual.pending.some((discipline) => discipline.code === targetCode)).toBe(false);
    expect(withManual.unmatchedApprovedAttempts.some((attempt) => attempt.sourceCode === "ZZZ999")).toBe(false);
    expect(withManual.alerts.some((alert) => alert.includes("Correlação manual aplicada"))).toBe(true);
  });

  it("recognizes approved disciplines from supplemental catalog by code", async () => {
    const parsed: ParsedTranscript = {
      parserVersion: "test",
      generatedAt: new Date().toISOString(),
      rawText: "",
      student: {
        registrationId: "222222",
        fullName: "Teste Catálogo Suplementar"
      },
      detectedMatrixCode: "981",
      matrixLabel: "Matriz 981",
      attempts: [
        {
          sourceSection: "optional",
          code: "ICSHX0",
          name: "Texto com ruído do PDF",
          cht: 45,
          chext: 0,
          status: "APPROVED",
          statusText: "Aprovado Por Nota/Frequência",
          rawBlock: "dummy"
        }
      ],
      explicitMissing: [],
      dependencies: [],
      summary: [],
      extensionSummary: [],
      unparsedBlocks: [],
      warnings: []
    };

    const roadmap = await calculateRoadmap(parsed, "981");
    expect(roadmap.unmatchedApprovedAttempts.some((attempt) => attempt.sourceCode === "ICSHX0")).toBe(false);
    expect(roadmap.unusedDisciplines.some((discipline) => discipline.code === "ICSHX0")).toBe(false);
  });

  it("applies partial manual convalidation hours without fully completing destination discipline", async () => {
    const parsed: ParsedTranscript = {
      parserVersion: "test",
      generatedAt: new Date().toISOString(),
      rawText: "",
      student: {
        registrationId: "333333",
        fullName: "Teste Convalidação Parcial"
      },
      detectedMatrixCode: "981",
      matrixLabel: "Matriz 981",
      attempts: [
        {
          sourceSection: "mandatory",
          code: "OLD123",
          name: "Introdução a Banco de Dados",
          cht: 45,
          chext: 0,
          status: "APPROVED",
          statusText: "Aprovado Por Nota/Frequência",
          rawBlock: "dummy"
        }
      ],
      explicitMissing: [],
      dependencies: [],
      summary: [],
      extensionSummary: [],
      unparsedBlocks: [],
      warnings: []
    };

    const roadmap = await calculateRoadmap(parsed, "981", [
      {
        sourceCode: "OLD123",
        targetCode: "ICSB30",
        targetCategory: "MANDATORY",
        creditedCHT: 45
      }
    ]);

    const mandatoryBucket = roadmap.progress.find((bucket) => bucket.key === "mandatory");
    expect(mandatoryBucket?.validatedCHT).toBe(45);
    expect(roadmap.pending.some((discipline) => discipline.code === "ICSB30")).toBe(true);
    expect(roadmap.unusedDisciplines.some((discipline) => discipline.code === "OLD123")).toBe(false);
  });

  it("allows manual-only convalidation when no destination discipline exists in matrix", async () => {
    const parsed: ParsedTranscript = {
      parserVersion: "test",
      generatedAt: new Date().toISOString(),
      rawText: "",
      student: {
        registrationId: "444444",
        fullName: "Teste Convalidação Manual"
      },
      detectedMatrixCode: "981",
      matrixLabel: "Matriz 981",
      attempts: [
        {
          sourceSection: "other",
          code: "OUT999",
          name: "Tópicos Livres Externos",
          cht: 30,
          chext: 0,
          status: "APPROVED",
          statusText: "Aprovado Por Nota/Frequência",
          rawBlock: "dummy"
        }
      ],
      explicitMissing: [],
      dependencies: [],
      summary: [],
      extensionSummary: [],
      unparsedBlocks: [],
      warnings: []
    };

    const roadmap = await calculateRoadmap(parsed, "981", [
      {
        sourceCode: "OUT999",
        sourceName: "Tópicos Livres Externos",
        manualOnly: true,
        targetCategory: "ELECTIVE",
        creditedCHT: 30,
        customDisciplineName: "Convalidação Manual Externa"
      }
    ]);

    const electiveBucket = roadmap.progress.find((bucket) => bucket.key === "elective");
    expect(electiveBucket?.validatedCHT).toBe(30);
    expect(roadmap.unusedDisciplines.some((discipline) => discipline.code === "OUT999")).toBe(false);
    expect(roadmap.alerts.some((alert) => alert.includes("OUT999->MANUAL(30h/ELECTIVE)"))).toBe(true);
  });
});
