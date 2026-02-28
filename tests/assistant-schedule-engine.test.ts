import { describe, expect, it } from "vitest";

import { buildAssistantScheduleProposals } from "@/lib/domain/assistant-schedule-engine";
import type { GradeOptionsResponse, GradeTurma } from "@/types/academic";

function makeTurma(codigo: string, horarios: string[]): GradeTurma {
  return {
    codigo,
    enquadramento: "Presencial",
    vagas_total: 40,
    vagas_calouros: 0,
    reserva: "Aberta",
    prioridade_cursos: [],
    horarios: horarios.map((horario) => ({ horario, sala: "A-101" })),
    professores: ["Docente"],
    optativa_matrizes: []
  };
}

function makeGradeOptions(
  availableByDiscipline: GradeOptionsResponse["availableByDiscipline"]
): GradeOptionsResponse {
  return {
    matrixCode: "981",
    campus: "01",
    course: "236",
    semesterUsed: "2025-2",
    lastUpdate: "2026-02-23",
    requestedCodes: availableByDiscipline.map((item) => item.code),
    availableByDiscipline,
    combinations: [],
    graduationPlan: {
      targetChsPerPeriod: 18,
      totalMissingCht: 0,
      totalMissingEstimatedChs: 0,
      periods: [
        {
          periodIndex: 1,
          totalEstimatedChs: 0,
          totalCht: 0,
          scheduledEstimatedChs: 0,
          unscheduledEstimatedChs: 0,
          disciplines: [],
          agenda: []
        }
      ],
      remainingCodes: [],
      remainingMissingCht: 0,
      remainingMissingEstimatedChs: 0,
      warnings: []
    },
    warnings: []
  };
}

describe("assistant schedule engine", () => {
  it("considers disciplines beyond the first six items", () => {
    const firstSix = Array.from({ length: 6 }, (_, idx) => ({
      code: `AAA${idx + 1}`,
      name: `Disciplina ${idx + 1}`,
      credits: 3,
      turmas: [makeTurma(`S${idx + 1}`, ["2M1", "2M2"])]
    }));

    const beyondSix = [
      {
        code: "ZZZ7",
        name: "Disciplina 7",
        credits: 3,
        turmas: [makeTurma("S77", ["3N1", "3N2"])]
      },
      {
        code: "ZZZ8",
        name: "Disciplina 8",
        credits: 3,
        turmas: [makeTurma("S88", ["4N1", "4N2"])]
      }
    ];

    const result = buildAssistantScheduleProposals({
      gradeOptions: makeGradeOptions([...firstSix, ...beyondSix]),
      constraints: {
        allowedShifts: ["N"],
        blockedShifts: ["M", "T"],
        targetSubjectsPerPeriod: 2
      },
      periodIndex: 3,
      optionsCount: 3
    });

    expect(result.proposals.length).toBeGreaterThan(0);
    const bestCodes = result.proposals[0].classes.map((item) => item.code);
    expect(bestCodes).toContain("ZZZ7");
    expect(bestCodes).toContain("ZZZ8");
  });

  it("generates relaxed alternatives when strict target is not reachable", () => {
    const result = buildAssistantScheduleProposals({
      gradeOptions: makeGradeOptions([
        {
          code: "ICSA31",
          name: "Teoria da Computação",
          credits: 3,
          turmas: [makeTurma("S71", ["5T4", "5T5", "5T6"])]
        },
        {
          code: "ICSA48",
          name: "Teoria dos Grafos",
          credits: 4,
          turmas: [makeTurma("S73", ["5N1", "5N2", "5N3", "5N4"])]
        }
      ]),
      constraints: {
        targetSubjectsPerPeriod: 5,
        maxAfternoonClasses: 1,
        maxAfternoonDays: 1,
        preferredAfternoonSlot: "15:50",
        allowedShifts: ["N", "T"]
      },
      periodIndex: 3,
      optionsCount: 3
    });

    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.proposals.some((proposal) => proposal.constraintReport.relaxed.length > 0)).toBe(true);
  });

  it("never returns proposals with schedule conflicts", () => {
    const result = buildAssistantScheduleProposals({
      gradeOptions: makeGradeOptions([
        {
          code: "DISC1",
          name: "Disciplina 1",
          credits: 3,
          turmas: [makeTurma("S11", ["2N1", "2N2"])]
        },
        {
          code: "DISC2",
          name: "Disciplina 2",
          credits: 3,
          turmas: [makeTurma("S22", ["2N1", "2N2"]), makeTurma("S23", ["3N1", "3N2"])]
        },
        {
          code: "DISC3",
          name: "Disciplina 3",
          credits: 3,
          turmas: [makeTurma("S33", ["4N1", "4N2"])]
        }
      ]),
      constraints: {
        allowedShifts: ["N"],
        blockedShifts: ["M", "T"]
      },
      periodIndex: 2,
      optionsCount: 3
    });

    expect(result.proposals.length).toBeGreaterThan(0);
    for (const proposal of result.proposals) {
      const slots = proposal.classes.flatMap((item) => item.horarios.map((horario) => horario.horario.toUpperCase()));
      const unique = new Set(slots);
      expect(unique.size).toBe(slots.length);
    }
  });

  it("prioritizes closest subject target before low-load plans", () => {
    const result = buildAssistantScheduleProposals({
      gradeOptions: makeGradeOptions([
        {
          code: "LOW1",
          name: "Carga baixa",
          credits: 1,
          turmas: [makeTurma("S01", ["6N3"])]
        },
        {
          code: "MID1",
          name: "Fim de tarde 1",
          credits: 3,
          turmas: [makeTurma("S11", ["2T6", "2N1"])]
        },
        {
          code: "MID2",
          name: "Fim de tarde 2",
          credits: 3,
          turmas: [makeTurma("S22", ["3T6", "3N1"])]
        },
        {
          code: "MID3",
          name: "Fim de tarde 3",
          credits: 3,
          turmas: [makeTurma("S33", ["4T6", "4N1"])]
        },
        {
          code: "MID4",
          name: "Fim de tarde 4",
          credits: 3,
          turmas: [makeTurma("S44", ["5T6", "5N1"])]
        }
      ]),
      constraints: {
        targetSubjectsPerPeriod: 5,
        preferredAfternoonSlot: "16:40"
      },
      periodIndex: 1,
      optionsCount: 3
    });

    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.proposals[0].subjectsCount).toBe(5);
  });
});
