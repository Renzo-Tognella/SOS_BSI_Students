import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/assistant/chat/route";
import type { GradeOptionsResponse, PendingDiscipline, RoadmapResult } from "@/types/academic";

function makeGradeOptions(): GradeOptionsResponse {
  const disciplines: GradeOptionsResponse["availableByDiscipline"] = [
    {
      code: "ICSA31",
      name: "Teoria da Computação",
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
            { horario: "2T4", sala: "A-101" },
            { horario: "2T5", sala: "A-101" }
          ],
          professores: ["Docente A"],
          optativa_matrizes: []
        }
      ]
    },
    {
      code: "ICSA48",
      name: "Teoria dos Grafos",
      credits: 4,
      turmas: [
        {
          codigo: "S73",
          enquadramento: "Presencial",
          vagas_total: 40,
          vagas_calouros: 0,
          reserva: "Aberta",
          prioridade_cursos: [],
          horarios: [
            { horario: "3N1", sala: "B-201" },
            { horario: "3N2", sala: "B-201" }
          ],
          professores: ["Docente B"],
          optativa_matrizes: []
        }
      ]
    },
    {
      code: "ICSB41",
      name: "Banco de Dados 2",
      credits: 4,
      turmas: [
        {
          codigo: "S73",
          enquadramento: "Presencial",
          vagas_total: 40,
          vagas_calouros: 0,
          reserva: "Aberta",
          prioridade_cursos: [],
          horarios: [
            { horario: "4T2", sala: "C-301" },
            { horario: "4T3", sala: "C-301" }
          ],
          professores: ["Docente C"],
          optativa_matrizes: []
        }
      ]
    },
    {
      code: "ICSM31",
      name: "Desenvolvimento Integrado de Sistemas",
      credits: 3,
      turmas: [
        {
          codigo: "S73",
          enquadramento: "Presencial",
          vagas_total: 40,
          vagas_calouros: 0,
          reserva: "Aberta",
          prioridade_cursos: [],
          horarios: [
            { horario: "5N1", sala: "D-401" },
            { horario: "5N2", sala: "D-401" }
          ],
          professores: ["Docente D"],
          optativa_matrizes: []
        }
      ]
    },
    {
      code: "ICSH31",
      name: "Introdução à Interação Humano-Computador",
      credits: 3,
      turmas: [
        {
          codigo: "S73",
          enquadramento: "Presencial",
          vagas_total: 40,
          vagas_calouros: 0,
          reserva: "Aberta",
          prioridade_cursos: [],
          horarios: [
            { horario: "6T4", sala: "E-501" },
            { horario: "6T5", sala: "E-501" }
          ],
          professores: ["Docente E"],
          optativa_matrizes: []
        }
      ]
    },
    {
      code: "ICSX41",
      name: "TCC 2",
      credits: 1,
      turmas: [
        {
          codigo: "S73",
          enquadramento: "Presencial",
          vagas_total: 40,
          vagas_calouros: 0,
          reserva: "Aberta",
          prioridade_cursos: [],
          horarios: [{ horario: "6N3", sala: "F-601" }],
          professores: ["Docente F"],
          optativa_matrizes: []
        }
      ]
    },
    {
      code: "ICSB56",
      name: "Ciência de Dados",
      credits: 4,
      turmas: [
        {
          codigo: "S73",
          enquadramento: "Presencial",
          vagas_total: 40,
          vagas_calouros: 0,
          reserva: "Aberta",
          prioridade_cursos: [],
          horarios: [
            { horario: "2M2", sala: "G-701" },
            { horario: "2M3", sala: "G-701" }
          ],
          professores: ["Docente G"],
          optativa_matrizes: []
        }
      ]
    }
  ];

  return {
    matrixCode: "981",
    campus: "01",
    course: "236",
    semesterUsed: "2025-2",
    lastUpdate: "2026-02-24",
    requestedCodes: disciplines.map((item) => item.code),
    availableByDiscipline: disciplines,
    combinations: [],
    graduationPlan: {
      targetChsPerPeriod: 18,
      totalMissingCht: 975,
      totalMissingEstimatedChs: 65,
      periods: [
        {
          periodIndex: 1,
          totalEstimatedChs: 18,
          totalCht: 270,
          scheduledEstimatedChs: 18,
          unscheduledEstimatedChs: 0,
          disciplines: [],
          agenda: []
        },
        {
          periodIndex: 2,
          totalEstimatedChs: 18,
          totalCht: 270,
          scheduledEstimatedChs: 18,
          unscheduledEstimatedChs: 0,
          disciplines: [],
          agenda: []
        },
        {
          periodIndex: 3,
          totalEstimatedChs: 18,
          totalCht: 270,
          scheduledEstimatedChs: 18,
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

function makeRoadmap(gradeOptions: GradeOptionsResponse): RoadmapResult {
  const pending: PendingDiscipline[] = gradeOptions.availableByDiscipline.map((item) => ({
    code: item.code,
    name: item.name,
    category: "TRACK",
    subcategory: "Inteligência Artificial",
    recommendedPeriod: 3,
    prerequisites: [],
    blockedBy: [],
    status: "AVAILABLE",
    cht: (item.credits ?? 1) * 15,
    chext: 0
  }));

  return {
    matrixCode: "981",
    student: {
      registrationId: "123",
      fullName: "Aluno Teste",
      courseCode: "236",
      courseName: "BSI"
    },
    progress: [
      {
        key: "mandatory",
        label: "Obrigatórias",
        requiredCHT: 1200,
        completedCHT: 225,
        validatedCHT: 0,
        missingCHT: 975
      }
    ],
    pending,
    prereqGraph: {
      nodes: [],
      edges: []
    },
    unusedDisciplines: [],
    unmatchedApprovedAttempts: [],
    electiveOptions: [],
    alerts: [],
    transcriptWarnings: [],
    computedAt: new Date().toISOString()
  };
}

function mockOpenRouterAnalysis(intent: string, constraints: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intent,
                    constraints,
                    reasoning: "simulated"
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("{}", { status: 404 });
    })
  );
}

async function callAssistant(
  message: string,
  options: { intent?: string; constraintsFromLlm?: Record<string, unknown> } = {}
) {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.GEMINI_API_KEY = "";
  mockOpenRouterAnalysis(options.intent ?? "PLAN_SCHEDULE", options.constraintsFromLlm ?? {});

  const gradeOptions = makeGradeOptions();
  const roadmap = makeRoadmap(gradeOptions);

  const request = new Request("http://localhost/api/assistant/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      matrixCode: "981",
      roadmap,
      gradeOptions,
      maxChsPerPeriod: 18
    })
  });

  const response = await POST(request);
  return (await response.json()) as Record<string, unknown>;
}

describe("assistant chat route simulations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  it("asks period when prompt does not include target period", async () => {
    const payload = await callAssistant("Monte uma grade com 5 matérias focando em noite e tarde", {
      constraintsFromLlm: { targetSubjectsPerPeriod: 5 }
    });

    expect(payload.action).toBe("ASK_PERIOD");
    expect(payload.question).toMatchObject({
      kind: "PERIOD"
    });
  });

  it("sanitizes LLM over-restrictions for night+afternoon focus and keeps high subject count", async () => {
    const payload = await callAssistant("Monte uma grade com 5 matérias focando em noite e tarde no período 1", {
      constraintsFromLlm: {
        targetSubjectsPerPeriod: 5,
        allowedShifts: ["N"],
        blockedShifts: ["M", "T"],
        maxAfternoonClasses: 1
      }
    });

    expect(payload.action).toBe("SHOW_PROPOSALS");
    const proposals = payload.proposals as Array<{ subjectsCount: number }>;
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.some((proposal) => proposal.subjectsCount >= 5)).toBe(true);
  });

  it("keeps hard work-window restriction from daily commitment scenario", async () => {
    const payload = await callAssistant(
      "Trabalho das 08:00 as 17:00 e quero montar 3 matérias no período 1",
      {
        constraintsFromLlm: {
          targetSubjectsPerPeriod: 3,
          allowedShifts: ["T", "N"]
        }
      }
    );

    expect(payload.action).toBe("SHOW_PROPOSALS");
    const proposals = payload.proposals as Array<{
      classes: Array<{ horarios: Array<{ horario: string }> }>;
    }>;
    expect(proposals.length).toBeGreaterThan(0);
    const hasMorningSlot = proposals.some((proposal) =>
      proposal.classes.some((classItem) =>
        classItem.horarios.some((slot) => slot.horario.toUpperCase().includes("M"))
      )
    );
    expect(hasMorningSlot).toBe(false);
  });

  it("still routes to schedule planner when LLM misclassifies as GENERAL_HELP", async () => {
    const payload = await callAssistant("Monte uma grade com 5 matérias no período 1", {
      intent: "GENERAL_HELP",
      constraintsFromLlm: {}
    });

    expect(payload.detectedIntent).toBe("PLAN_SCHEDULE");
    expect(payload.action).toBe("SHOW_PROPOSALS");
  });

  it("handles mixed daytime+late requirement without collapsing to one subject", async () => {
    const payload = await callAssistant(
      "Esse semestre só posso fazer uma matéria entre 08:00 e 17:00 de preferência 15:50 e quero mais 4 além dessa a partir de 16:40 no período 1",
      {
        constraintsFromLlm: {
          targetSubjectsPerPeriod: 5,
          maxAfternoonClasses: 1,
          preferredAfternoonSlot: "15:50",
          allowedShifts: ["N"],
          blockedShifts: ["M", "T"]
        }
      }
    );

    expect(payload.action).toBe("SHOW_PROPOSALS");
    const proposals = payload.proposals as Array<{ subjectsCount: number }>;
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].subjectsCount).toBeGreaterThanOrEqual(4);
  });
});
