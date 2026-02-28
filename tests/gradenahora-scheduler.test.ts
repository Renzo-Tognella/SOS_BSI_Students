import { describe, expect, it } from "vitest";

import { buildGraduationPlan, buildScheduleCombinations, buildSemesterCandidates } from "@/lib/integrations/gradenahora-scheduler";

describe("gradenahora scheduler", () => {
  it("builds semester fallback list", () => {
    const reference = new Date("2026-02-21T12:00:00Z");
    const semesters = buildSemesterCandidates(reference, 6);

    expect(semesters[0]).toBe("2026-1");
    expect(semesters[1]).toBe("2025-2");
    expect(semesters.length).toBe(6);
  });

  it("creates conflict-free combinations", () => {
    const combinations = buildScheduleCombinations([
      {
        code: "ICSD20",
        name: "Lógica",
        credits: 3,
        turmas: [
          {
            codigo: "S71",
            enquadramento: "Presencial",
            vagas_total: 40,
            vagas_calouros: 0,
            reserva: "Aberta",
            prioridade_cursos: [],
            horarios: [
              { horario: "2T1", sala: "A1" },
              { horario: "2T2", sala: "A1" }
            ],
            professores: ["Prof A"],
            optativa_matrizes: []
          }
        ]
      },
      {
        code: "ICSF20",
        name: "ED1",
        credits: 3,
        turmas: [
          {
            codigo: "S72",
            enquadramento: "Presencial",
            vagas_total: 40,
            vagas_calouros: 0,
            reserva: "Aberta",
            prioridade_cursos: [],
            horarios: [{ horario: "3T1", sala: "B2" }],
            professores: ["Prof B"],
            optativa_matrizes: []
          },
          {
            codigo: "S73",
            enquadramento: "Presencial",
            vagas_total: 40,
            vagas_calouros: 0,
            reserva: "Aberta",
            prioridade_cursos: [],
            horarios: [{ horario: "2T1", sala: "C3" }],
            professores: ["Prof C"],
            optativa_matrizes: []
          }
        ]
      }
    ]);

    expect(combinations.length).toBeGreaterThan(0);

    const best = combinations[0];
    expect(best.coveredPendingCodes).toContain("ICSD20");
    expect(best.coveredPendingCodes).toContain("ICSF20");
    expect(best.classes.some((cls) => cls.classCode === "S73")).toBe(false);
  });

  it("builds graduation plan by period respecting prerequisites and CHS target", () => {
    const plan = buildGraduationPlan({
      matrix: {
        matrixCode: "981",
        courseCode: "236",
        courseName: "SI",
        versionName: "Teste",
        totals: {
          mandatoryCHT: 0,
          optionalCHT: 0,
          electiveCHT: 0,
          complementaryCHT: 0,
          internshipCHT: 0,
          tccCHT: 0,
          extensionCHT: 0
        },
        disciplines: [
          {
            code: "A100",
            name: "Disciplina A",
            category: "MANDATORY",
            cht: 60,
            prerequisites: []
          },
          {
            code: "B100",
            name: "Disciplina B",
            category: "MANDATORY",
            cht: 60,
            prerequisites: ["A100"]
          },
          {
            code: "C100",
            name: "Disciplina C",
            category: "MANDATORY",
            cht: 60,
            prerequisites: []
          }
        ]
      },
      pendingCodes: ["A100", "B100", "C100"],
      available: [
        {
          code: "A100",
          name: "Disciplina A",
          credits: 4,
          turmas: [
            {
              codigo: "S71",
              enquadramento: "Presencial",
              vagas_total: 40,
              vagas_calouros: 0,
              reserva: "Aberta",
              prioridade_cursos: [],
              horarios: [{ horario: "2T1", sala: "A1" }],
              professores: ["Prof A"],
              optativa_matrizes: []
            }
          ]
        },
        {
          code: "B100",
          name: "Disciplina B",
          credits: 4,
          turmas: [
            {
              codigo: "S72",
              enquadramento: "Presencial",
              vagas_total: 40,
              vagas_calouros: 0,
              reserva: "Aberta",
              prioridade_cursos: [],
              horarios: [{ horario: "3T1", sala: "B1" }],
              professores: ["Prof B"],
              optativa_matrizes: []
            }
          ]
        },
        {
          code: "C100",
          name: "Disciplina C",
          credits: 4,
          turmas: [
            {
              codigo: "S73",
              enquadramento: "Presencial",
              vagas_total: 40,
              vagas_calouros: 0,
              reserva: "Aberta",
              prioridade_cursos: [],
              horarios: [{ horario: "4T1", sala: "C1" }],
              professores: ["Prof C"],
              optativa_matrizes: []
            }
          ]
        }
      ],
      targetChsPerPeriod: 8
    });

    expect(plan.periods.length).toBeGreaterThan(1);
    expect(plan.periods[0]?.disciplines.some((discipline) => discipline.code === "A100")).toBe(true);
    expect(plan.periods[0]?.disciplines.some((discipline) => discipline.code === "B100")).toBe(false);
    expect(plan.periods[1]?.disciplines.some((discipline) => discipline.code === "B100")).toBe(true);
    expect(plan.remainingCodes).toHaveLength(0);
  });

  it("includes synthetic elective pending codes in graduation plan", () => {
    const plan = buildGraduationPlan({
      matrix: {
        matrixCode: "981",
        courseCode: "236",
        courseName: "SI",
        versionName: "Teste",
        totals: {
          mandatoryCHT: 0,
          optionalCHT: 0,
          electiveCHT: 105,
          complementaryCHT: 0,
          internshipCHT: 0,
          tccCHT: 0,
          extensionCHT: 0
        },
        disciplines: []
      },
      pendingCodes: ["ELVP001C015", "ELVP002C015", "ELVP003C030"],
      available: [],
      targetChsPerPeriod: 2
    });

    expect(plan.warnings.some((warning) => warning.includes("não encontrado na matriz"))).toBe(false);
    expect(plan.totalMissingCht).toBe(60);
    expect(plan.periods.length).toBeGreaterThan(0);
    expect(plan.periods.flatMap((period) => period.disciplines).map((discipline) => discipline.code)).toEqual([
      "ELVP001C015",
      "ELVP002C015",
      "ELVP003C030"
    ]);
    expect(plan.remainingCodes).toHaveLength(0);
  });
});
