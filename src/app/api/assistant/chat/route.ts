import { NextResponse } from "next/server";
import { z } from "zod";

import type {
  AssistantChatResponse,
  AssistantPlanPatch,
  AssistantScheduleConstraint,
  GradeOptionsResponse,
  MatrixCode,
  ParsedTranscript,
  RoadmapResult
} from "@/types/academic";
import { FORECAST_CHEXT_NOTE, FORECAST_INTERNSHIP_NOTE, resolveMissingWorkload } from "@/lib/domain/graduation-forecast";
import { buildGradeNaHoraUrl } from "@/lib/integrations/gradenahora-client";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().min(1),
  matrixCode: z.enum(["806", "981"]).optional(),
  roadmap: z.any().optional(),
  parsedTranscript: z.any().optional(),
  gradeOptions: z.any().optional(),
  selectedTrackLabels: z.array(z.string().min(1)).max(20).optional(),
  selectedPeriodIndex: z.number().int().min(1).max(20).optional(),
  maxChsPerPeriod: z.number().int().min(1).max(40).optional()
});

const aiAnalysisSchema = z.object({
  intent: z.enum(["PLAN_SCHEDULE", "GRADUATION_ESTIMATE", "TRACK_IA", "AVAILABLE_DISCIPLINES", "GENERAL_HELP"]),
  constraints: z
    .object({
      targetChsPerPeriod: z.number().int().min(1).max(40).optional(),
      offSemesters: z.number().int().min(0).max(10).optional(),
      workStartHour: z.number().int().min(0).max(23).optional(),
      workEndHour: z.number().int().min(0).max(23).optional(),
      maxAfternoonDays: z.number().int().min(0).max(6).optional(),
      maxAfternoonClasses: z.number().int().min(0).max(20).optional(),
      allowedShifts: z.array(z.enum(["M", "T", "N"])).optional(),
      blockedShifts: z.array(z.enum(["M", "T", "N"])).optional()
    })
    .optional(),
  reasoning: z.string().optional()
});

type AiIntent = z.infer<typeof aiAnalysisSchema>["intent"];
type AiProvider = "openrouter" | "gemini" | "rule-based";

const GRADENAHORA_UTFPR_URL = "https://gradenahora.com.br/utfpr";
const UTFPR_BSI_CURITIBA_URL =
  "https://www.utfpr.edu.br/cursos/coordenacoes/graduacao/curitiba/ct-bacharelado-em-sistemas-de-informacao";
const UTFPR_BSI_CURITIBA_MATRIX_URL =
  "https://www.utfpr.edu.br/cursos/coordenacoes/graduacao/curitiba/ct-bacharelado-em-sistemas-de-informacao/matriz-e-docentes";
const UTFPR_MATRICULA_2026_1_URL =
  "https://www.utfpr.edu.br/noticias/ultima-noticias/veteranos-ja-tem-datas-definidas-para-matricula-de-2026-1";
const UTFPR_CURITIBA_CALENDAR_2026_URL = "https://cloud.utfpr.edu.br/index.php/s/zH2XruJe77qcMzd";
const UTFPR_CURITIBA_SPECIAL_DATES_2026_URL = "https://cloud.utfpr.edu.br/index.php/s/S4Xq8cdNFnWL9oX";
const DEFAULT_BSI_CURITIBA_CAMPUS = "01";
const DEFAULT_BSI_CURITIBA_COURSE = "236";

interface AiAnalysisResult {
  intent: AiIntent;
  constraints?: AssistantScheduleConstraint;
  providerUsed: Exclude<AiProvider, "rule-based">;
}

function selectedTracksNote(selectedTrackLabels?: string[]): string {
  if (!selectedTrackLabels || selectedTrackLabels.length === 0) {
    return "";
  }
  return ` Trilhas selecionadas no planejamento: ${selectedTrackLabels.join(", ")}.`;
}

function buildOfficialSourcesBlock(gradeOptions?: GradeOptionsResponse): string {
  const lines = [
    "Fontes oficiais e dados para conferência:",
    `- UTFPR BSI Curitiba (curso): ${UTFPR_BSI_CURITIBA_URL}`,
    `- UTFPR BSI Curitiba (matriz e docentes): ${UTFPR_BSI_CURITIBA_MATRIX_URL}`,
    `- UTFPR matrícula 2026.1 (veteranos): ${UTFPR_MATRICULA_2026_1_URL}`,
    `- UTFPR calendário Curitiba 2026: ${UTFPR_CURITIBA_CALENDAR_2026_URL}`,
    `- UTFPR datas especiais Curitiba 2026: ${UTFPR_CURITIBA_SPECIAL_DATES_2026_URL}`,
    `- GradeNaHora UTFPR (base): ${GRADENAHORA_UTFPR_URL}`
  ];

  if (gradeOptions) {
    const gradeSemesterUrl = buildGradeNaHoraUrl(gradeOptions.semesterUsed, gradeOptions.campus, gradeOptions.course);
    lines.push(`- GradeNaHora usado no app (${gradeOptions.semesterUsed}): ${gradeSemesterUrl}`);
  } else {
    const sampleUrl = buildGradeNaHoraUrl("2026-1", DEFAULT_BSI_CURITIBA_CAMPUS, DEFAULT_BSI_CURITIBA_COURSE);
    lines.push(`- GradeNaHora BSI/Curitiba (exemplo): ${sampleUrl}`);
  }

  lines.push(
    "Regra operacional: sempre buscar matérias de BSI no semestre mais recente disponível do GradeNaHora; se houver 404, recuar semestre a semestre automaticamente."
  );

  return lines.join("\n");
}

function summarizePendingByPeriod(roadmap: RoadmapResult): string {
  const byPeriod = new Map<number, { count: number; cht: number }>();
  let withoutPeriodCount = 0;
  let withoutPeriodCht = 0;

  for (const discipline of roadmap.pending) {
    if (typeof discipline.recommendedPeriod === "number" && Number.isFinite(discipline.recommendedPeriod)) {
      const key = Math.max(1, Math.floor(discipline.recommendedPeriod));
      const current = byPeriod.get(key) ?? { count: 0, cht: 0 };
      current.count += 1;
      current.cht += Math.max(discipline.cht ?? 0, 0);
      byPeriod.set(key, current);
      continue;
    }

    withoutPeriodCount += 1;
    withoutPeriodCht += Math.max(discipline.cht ?? 0, 0);
  }

  const sorted = [...byPeriod.entries()].sort((a, b) => a[0] - b[0]);
  const parts = sorted.map(([period, values]) => `P${period}: ${values.count} disciplina(s), ${values.cht} CHT`);
  if (withoutPeriodCount > 0) {
    parts.push(`Sem período recomendado: ${withoutPeriodCount} disciplina(s), ${withoutPeriodCht} CHT`);
  }

  return parts.length > 0 ? parts.join(" | ") : "Sem pendências mapeadas por período.";
}

function answerAssistantRoleAndData(params: {
  roadmap: RoadmapResult;
  parsedTranscript?: ParsedTranscript;
  gradeOptions?: GradeOptionsResponse;
  matrixCode: MatrixCode;
  selectedTrackLabels?: string[];
}): AssistantChatResponse {
  const { roadmap, parsedTranscript, gradeOptions, matrixCode, selectedTrackLabels } = params;
  const missing = resolveMissingWorkload({
    parsedTranscript,
    roadmap
  });

  const availablePending = roadmap.pending.filter((discipline) => discipline.status === "AVAILABLE").length;
  const blockedPending = roadmap.pending.filter((discipline) => discipline.status === "BLOCKED").length;
  const pendingByPeriod = summarizePendingByPeriod(roadmap);
  const semesterInfo = gradeOptions ? gradeOptions.semesterUsed : "não carregado";

  return {
    detectedIntent: "GENERAL_HELP",
    answer: [
      "Papel do assistente no SaveStudents:",
      "1) Traduzir seu pedido para restrições objetivas de grade (CHS alvo, turnos, limite de tardes e semestre alvo).",
      "2) Sugerir combinação de turmas com menor conflito, sem inventar disciplina fora da oferta real.",
      "3) Mostrar projeção de formatura por CHS com base oficial do histórico (CHEXT e Estágio fora da projeção).",
      "4) Explicar claramente o que falta, por período, para você conseguir se planejar.",
      "",
      "Dados internos usados agora:",
      `- Matriz ativa: ${matrixCode}`,
      `- Pendências totais: ${roadmap.pending.length} (liberadas: ${availablePending}, bloqueadas: ${blockedPending})`,
      `- Faltante oficial: ${missing.missingCht} CHT (${missing.missingChs} CHS)`,
      `- CHEXT pendente (informativo): ${missing.missingChext}h`,
      `- Resumo de faltantes por período: ${pendingByPeriod}`,
      `- Trilhas selecionadas: ${selectedTrackLabels && selectedTrackLabels.length > 0 ? selectedTrackLabels.join(", ") : "todas as trilhas pendentes"}`,
      `- Oferta de turmas carregada: ${semesterInfo}`,
      "",
      buildOfficialSourcesBlock(gradeOptions),
      "",
      `Obs.: ${FORECAST_CHEXT_NOTE} ${FORECAST_INTERNSHIP_NOTE}`
    ].join("\n")
  };
}

function extractJsonObject(input: string): string | null {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return input.slice(start, end + 1);
}

async function analyzeWithOpenRouter(params: {
  message: string;
  matrixCode: MatrixCode;
  fallbackChs: number;
}): Promise<AiAnalysisResult | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.OPENROUTER_MODEL ?? "minimax/minimax-m2.5";
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  const prompt =
    "Classifique a mensagem do aluno e extraia restrições de grade. Responda APENAS JSON no formato: " +
    '{"intent":"PLAN_SCHEDULE|GRADUATION_ESTIMATE|TRACK_IA|AVAILABLE_DISCIPLINES|GENERAL_HELP","constraints":{"targetChsPerPeriod":14,"offSemesters":1,"workStartHour":9,"workEndHour":17,"maxAfternoonDays":1,"maxAfternoonClasses":1,"allowedShifts":["N"],"blockedShifts":["M","T"]},"reasoning":"..."}';

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "http://localhost:3000",
      "X-Title": "SaveStudents Roadmap Assistant"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content:
            `${prompt}\nConsidere matriz ${params.matrixCode}. CHS padrão ${params.fallbackChs}. ` +
            "Regras estritas: " +
            "1) Se o aluno trabalha 08-17 (ou equivalente), bloquear M e T e permitir N. " +
            "2) Se o aluno disser que pode apenas 1 matéria/aula à tarde, definir maxAfternoonClasses=1 e maxAfternoonDays=1. " +
            "3) Nunca relaxe restrição de horário sem o aluno pedir explicitamente."
        },
        { role: "user", content: params.message }
      ]
    })
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return null;
  }

  const jsonLike = extractJsonObject(content);
  if (!jsonLike) {
    return null;
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(jsonLike);
  } catch {
    return null;
  }

  const parsed = aiAnalysisSchema.safeParse(parsedPayload);
  if (!parsed.success) {
    return null;
  }

  return {
    intent: parsed.data.intent,
    constraints: parsed.data.constraints,
    providerUsed: "openrouter"
  };
}

async function analyzeWithGemini(params: {
  message: string;
  matrixCode: MatrixCode;
  fallbackChs: number;
}): Promise<AiAnalysisResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const prompt =
    "Retorne apenas JSON com {intent, constraints, reasoning}. intents válidos: PLAN_SCHEDULE, GRADUATION_ESTIMATE, TRACK_IA, AVAILABLE_DISCIPLINES, GENERAL_HELP. " +
    "Quando houver trabalho 08-17, bloqueie M/T e permita N. Quando houver 'apenas 1 matéria/aula à tarde', use maxAfternoonClasses=1 e maxAfternoonDays=1. " +
    `Matriz ${params.matrixCode}, CHS padrão ${params.fallbackChs}. Mensagem: ${params.message}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: { temperature: 0, maxOutputTokens: 220 },
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    return null;
  }

  const jsonLike = extractJsonObject(text);
  if (!jsonLike) {
    return null;
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(jsonLike);
  } catch {
    return null;
  }

  const parsed = aiAnalysisSchema.safeParse(parsedPayload);
  if (!parsed.success) {
    return null;
  }

  return {
    intent: parsed.data.intent,
    constraints: parsed.data.constraints,
    providerUsed: "gemini"
  };
}

async function analyzeIntentWithFallback(params: {
  message: string;
  matrixCode: MatrixCode;
  fallbackChs: number;
}): Promise<{ analysis: AiAnalysisResult | null; providerUsed: AiProvider; diagnostics: string[] }> {
  const diagnostics: string[] = [];

  try {
    const openrouter = await analyzeWithOpenRouter(params);
    if (openrouter) {
      diagnostics.push("Classificação de intenção via OpenRouter.");
      return { analysis: openrouter, providerUsed: "openrouter", diagnostics };
    }
    diagnostics.push("OpenRouter indisponível, sem chave ou resposta inválida.");
  } catch (error) {
    diagnostics.push(`OpenRouter falhou: ${(error as Error).message}`);
  }

  try {
    const gemini = await analyzeWithGemini(params);
    if (gemini) {
      diagnostics.push("Classificação de intenção via Gemini.");
      return { analysis: gemini, providerUsed: "gemini", diagnostics };
    }
    diagnostics.push("Gemini indisponível, sem chave ou resposta inválida.");
  } catch (error) {
    diagnostics.push(`Gemini falhou: ${(error as Error).message}`);
  }

  diagnostics.push("Fallback para classificador local por regex.");
  return { analysis: null, providerUsed: "rule-based", diagnostics };
}

function parseHour(value: string): number {
  const normalized = value.replace("h", ":").replace(".", ":");
  const [hourRaw] = normalized.split(":");
  const hour = Number(hourRaw);
  if (!Number.isFinite(hour)) {
    return 0;
  }
  return Math.max(0, Math.min(23, hour));
}

function parseConstraints(message: string, fallbackChs: number): AssistantScheduleConstraint {
  const text = message.toLowerCase();
  const constraints: AssistantScheduleConstraint = {
    targetChsPerPeriod: fallbackChs
  };

  const chsMatch = text.match(/(\d{1,2})\s*(?:chs|chs\/semestre|creditos|créditos)/i);
  if (chsMatch) {
    constraints.targetChsPerPeriod = Math.max(1, Math.min(40, Number(chsMatch[1])));
  }

  const offMatch = text.match(/(\d+)\s*semestre(?:s)?\s*(?:off|fora|pausa|parado)/i);
  if (offMatch) {
    constraints.offSemesters = Math.max(0, Number(offMatch[1]));
  }

  const workMatch =
    text.match(/trabalh\w*\s*(?:das|de)?\s*(\d{1,2}(?::\d{2}|h\d{0,2})?)\s*(?:as|até|a)\s*(\d{1,2}(?::\d{2}|h\d{0,2})?)/i) ??
    text.match(/(\d{1,2}(?::\d{2}|h\d{0,2})?)\s*(?:as|até|a)\s*(\d{1,2}(?::\d{2}|h\d{0,2})?)/i);
  if (workMatch) {
    constraints.workStartHour = parseHour(workMatch[1]);
    constraints.workEndHour = parseHour(workMatch[2]);
    if ((constraints.workStartHour ?? 0) <= 9 && (constraints.workEndHour ?? 0) >= 17) {
      constraints.blockedShifts = ["M", "T"];
      constraints.allowedShifts = ["N"];
    }
  }

  if (/so pode.*(?:1|um)\s*dia.*tarde|apenas.*(?:1|um)\s*dia.*tarde/i.test(text)) {
    constraints.maxAfternoonDays = 1;
  } else {
    const afternoonDaysMatch = text.match(/(?:no maximo|maximo|até)\s*(\d+)\s*dias?.*tarde/i);
    if (afternoonDaysMatch) {
      constraints.maxAfternoonDays = Math.max(0, Number(afternoonDaysMatch[1]));
    }
  }

  if (/somente.*noite|só.*noite|apenas.*noite/i.test(text)) {
    constraints.allowedShifts = ["N"];
    constraints.blockedShifts = ["M", "T"];
  }

  if (
    /(apenas|somente|s[oó]).*(1|uma)\s*(mat[eé]ria|aula).*(15[:h]?50|tarde)/i.test(text) ||
    /(15[:h]?50).*(apenas|somente|s[oó]).*(1|uma)\s*(mat[eé]ria|aula)/i.test(text)
  ) {
    constraints.maxAfternoonClasses = 1;
    constraints.maxAfternoonDays = Math.min(constraints.maxAfternoonDays ?? 1, 1);
    constraints.allowedShifts = ["N"];
    constraints.blockedShifts = ["M", "T"];
  }

  return constraints;
}

function mergeConstraints(
  parsed: AssistantScheduleConstraint,
  override?: AssistantScheduleConstraint
): AssistantScheduleConstraint {
  if (!override) {
    return parsed;
  }

  return {
    ...parsed,
    ...override,
    allowedShifts:
      override.allowedShifts && override.allowedShifts.length > 0
        ? override.allowedShifts
        : parsed.allowedShifts,
    blockedShifts:
      override.blockedShifts && override.blockedShifts.length > 0
        ? override.blockedShifts
        : parsed.blockedShifts
  };
}

function decodeHorario(horario: string): { day: string; shift: "M" | "T" | "N" | "X" } {
  const normalized = horario.trim().toUpperCase();
  const match = normalized.match(/^([2-7])([MTN])\d+$/);
  return {
    day: match?.[1] ?? "0",
    shift: (match?.[2] as "M" | "T" | "N") ?? "X"
  };
}

function countAfternoonDays(classes: Array<{ horarios: Array<{ horario: string }> }>): number {
  const days = new Set<string>();
  for (const classItem of classes) {
    for (const slot of classItem.horarios) {
      const decoded = decodeHorario(slot.horario);
      if (decoded.shift === "T") {
        days.add(decoded.day);
      }
    }
  }
  return days.size;
}

function countClassesInShift(
  classes: Array<{ disciplineCode: string; classCode: string; horarios: Array<{ horario: string }> }>,
  shift: "M" | "T" | "N"
): number {
  const keys = new Set<string>();
  for (const classItem of classes) {
    const hasShift = classItem.horarios.some((slot) => decodeHorario(slot.horario).shift === shift);
    if (hasShift) {
      keys.add(`${classItem.disciplineCode}-${classItem.classCode}`);
    }
  }
  return keys.size;
}

function violatesShiftConstraint(
  classes: Array<{ disciplineCode: string; classCode: string; horarios: Array<{ horario: string }> }>,
  constraints: AssistantScheduleConstraint
): boolean {
  const blocked = new Set(constraints.blockedShifts ?? []);
  const allowed = constraints.allowedShifts ? new Set(constraints.allowedShifts) : null;
  const maxAfternoonClasses = constraints.maxAfternoonClasses;

  for (const classItem of classes) {
    for (const slot of classItem.horarios) {
      const decoded = decodeHorario(slot.horario);
      if (decoded.shift === "X") {
        continue;
      }
      const isAfternoonException =
        decoded.shift === "T" &&
        typeof maxAfternoonClasses === "number" &&
        maxAfternoonClasses > 0;

      if (blocked.has(decoded.shift) && !isAfternoonException) {
        return true;
      }
      if (allowed && !allowed.has(decoded.shift) && !isAfternoonException) {
        return true;
      }
    }
  }

  if (typeof maxAfternoonClasses === "number") {
    return countClassesInShift(classes, "T") > maxAfternoonClasses;
  }

  return false;
}

function chooseBestPlanPatch(params: {
  gradeOptions: GradeOptionsResponse;
  constraints: AssistantScheduleConstraint;
  periodIndex: number;
}): AssistantPlanPatch | undefined {
  const { gradeOptions, constraints, periodIndex } = params;
  const targetChs = Math.max(1, constraints.targetChsPerPeriod ?? 18);

  const ranked = gradeOptions.combinations
    .filter((combination) => !violatesShiftConstraint(combination.classes, constraints))
    .filter((combination) => {
      if (typeof constraints.maxAfternoonDays !== "number") {
        return true;
      }
      return countAfternoonDays(combination.classes) <= constraints.maxAfternoonDays;
    })
    .sort((a, b) => {
      const distA = Math.abs((a.weeklyCredits ?? 0) - targetChs);
      const distB = Math.abs((b.weeklyCredits ?? 0) - targetChs);
      if (distA !== distB) {
        return distA - distB;
      }
      if (b.classes.length !== a.classes.length) {
        return b.classes.length - a.classes.length;
      }
      return a.conflictCountAvoided - b.conflictCountAvoided;
    });

  const picked = ranked[0];
  if (!picked) {
    return undefined;
  }

  const classes = picked.classes.map((item) => ({
    code: item.disciplineCode,
    name: item.disciplineName,
    classCode: item.classCode,
    horarios: item.horarios,
    weeklyCredits: item.weeklyCredits ?? 0
  }));

  return {
    periodIndex,
    targetChs,
    achievedChs: picked.weeklyCredits,
    constraintsApplied: constraints,
    classes,
    payload: {
      periodIndex,
      disciplines: classes.map((item) => item.code),
      classes: classes.map((item) => ({
        code: item.code,
        classCode: item.classCode,
        horarios: item.horarios.map((slot) => slot.horario),
        weeklyCredits: item.weeklyCredits
      }))
    }
  };
}

function nextSemester(semesterLabel: string): string {
  const match = semesterLabel.match(/^(\d{4})-(1|2)$/);
  if (!match) {
    return "2026-2";
  }
  const year = Number(match[1]);
  const semester = Number(match[2]);
  return semester === 1 ? `${year}-2` : `${year + 1}-1`;
}

function addSemesters(baseLabel: string, count: number): string {
  let cursor = baseLabel;
  for (let index = 0; index < count; index += 1) {
    cursor = nextSemester(cursor);
  }
  return cursor;
}

function estimateGraduationAnswer(params: {
  roadmap: RoadmapResult;
  parsedTranscript?: ParsedTranscript;
  message: string;
  gradeOptions?: GradeOptionsResponse;
  fallbackChs: number;
  overrideConstraints?: AssistantScheduleConstraint;
}): AssistantChatResponse {
  const { roadmap, parsedTranscript, message, gradeOptions, fallbackChs, overrideConstraints } = params;
  const parsedConstraints = parseConstraints(message, fallbackChs);
  const constraints = mergeConstraints(parsedConstraints, overrideConstraints);
  const missing = resolveMissingWorkload({
    parsedTranscript,
    roadmap
  });
  const missingCht = missing.missingCht;
  const missingChs = missing.missingChs;
  const targetChs = Math.max(1, constraints.targetChsPerPeriod ?? fallbackChs);
  const requiredSemesters = Math.ceil(missingChs / targetChs) + (constraints.offSemesters ?? 0);
  const baseSemester = gradeOptions?.semesterUsed ?? "2026-1";
  const endSemester = addSemesters(baseSemester, requiredSemesters);
  const chextDetails = missing.missingChext > 0 ? ` CHEXT pendente: ${missing.missingChext}h (fora da projeção).` : "";

  return {
    detectedIntent: "GRADUATION_ESTIMATE",
    detectedConstraints: constraints,
    answer:
      `Com ${targetChs} CHS/semestre e faltando ~${missingChs} CHS (${missingCht} CHT), a projeção é de ${Math.max(requiredSemesters, 0)} semestre(s). ` +
      `Partindo de ${baseSemester}, conclusão estimada em ${endSemester}.` +
      `${(constraints.offSemesters ?? 0) > 0 ? ` Já considerei ${constraints.offSemesters} semestre(s) off.` : ""}` +
      `${chextDetails} Obs.: ${FORECAST_CHEXT_NOTE} ${FORECAST_INTERNSHIP_NOTE}`
  };
}

function answerIaTrack(roadmap: RoadmapResult): AssistantChatResponse {
  const pendingIa = roadmap.pending.filter(
    (discipline) =>
      discipline.category === "TRACK" &&
      discipline.status === "AVAILABLE" &&
      (discipline.subcategory?.toLowerCase().includes("intelig") || discipline.name.toLowerCase().includes("intelig"))
  );
  const blockedIa = roadmap.pending.filter(
    (discipline) =>
      discipline.category === "TRACK" &&
      discipline.status === "BLOCKED" &&
      (discipline.subcategory?.toLowerCase().includes("intelig") || discipline.name.toLowerCase().includes("intelig"))
  );

  const availableText =
    pendingIa.length > 0
      ? pendingIa.map((item) => `${item.code} - ${item.name} (${item.cht} CHT)`).join("; ")
      : "nenhuma disciplina de IA liberada no momento";
  const blockedText =
    blockedIa.length > 0
      ? ` Bloqueadas: ${blockedIa.map((item) => `${item.code}`).join(", ")}.`
      : "";

  return {
    detectedIntent: "TRACK_IA",
    answer: `Disciplinas de trilha IA que você já pode pegar: ${availableText}.${blockedText}`
  };
}

function answerAvailableDisciplines(gradeOptions?: GradeOptionsResponse, selectedTrackLabels?: string[]): AssistantChatResponse {
  if (!gradeOptions) {
    return {
      detectedIntent: "AVAILABLE_DISCIPLINES",
      answer:
        "Para listar disciplinas/turmas disponíveis, primeiro clique em 'Gerar Plano de Formatura' na página de Grade.\n\n" +
        buildOfficialSourcesBlock(undefined) +
        selectedTracksNote(selectedTrackLabels)
    };
  }

  const gradeSemesterUrl = buildGradeNaHoraUrl(gradeOptions.semesterUsed, gradeOptions.campus, gradeOptions.course);
  const preview = gradeOptions.availableByDiscipline
    .slice(0, 15)
    .map((item) => `${item.code} (${item.turmas.length} turma(s))`)
    .join(", ");

  return {
    detectedIntent: "AVAILABLE_DISCIPLINES",
    answer:
      `No semestre ${gradeOptions.semesterUsed}, encontrei ${gradeOptions.availableByDiscipline.length} disciplina(s) com turma: ${preview}.\n` +
      `Fonte da oferta usada: ${gradeSemesterUrl}.\n` +
      "Regra aplicada: usar o semestre mais recente disponível para BSI (fallback automático para semestres anteriores se necessário)." +
      selectedTracksNote(selectedTrackLabels)
  };
}

function answerSchedulePlan(params: {
  roadmap: RoadmapResult;
  parsedTranscript?: ParsedTranscript;
  gradeOptions?: GradeOptionsResponse;
  message: string;
  periodIndex: number;
  fallbackChs: number;
  overrideConstraints?: AssistantScheduleConstraint;
  selectedTrackLabels?: string[];
}): AssistantChatResponse {
  const { roadmap, parsedTranscript, gradeOptions, message, periodIndex, fallbackChs, overrideConstraints, selectedTrackLabels } = params;
  const parsedConstraints = parseConstraints(message, fallbackChs);
  const constraints = mergeConstraints(parsedConstraints, overrideConstraints);

  if (!gradeOptions) {
    return {
      detectedIntent: "PLAN_SCHEDULE",
      detectedConstraints: constraints,
      answer:
        "Consigo montar a grade com IA, mas preciso da oferta do GradeNaHora carregada. Vá na página Grade e clique em 'Gerar Plano de Formatura', depois tente de novo.\n\n" +
        buildOfficialSourcesBlock(undefined) +
        selectedTracksNote(selectedTrackLabels)
    };
  }

  const planPatch = chooseBestPlanPatch({ gradeOptions, constraints, periodIndex });
  if (!planPatch) {
    return {
      detectedIntent: "PLAN_SCHEDULE",
      detectedConstraints: constraints,
      answer:
        "Não encontrei combinação que respeite essas restrições para este semestre. Tente relaxar limite de tarde, aumentar CHS alvo ou permitir mais turnos."
    };
  }

  const classesSummary = planPatch.classes.map((item) => `${item.code}-${item.classCode}`).join(", ");
  const missing = resolveMissingWorkload({
    parsedTranscript,
    roadmap
  });
  const missingChs = missing.missingChs;

  return {
    detectedIntent: "PLAN_SCHEDULE",
    detectedConstraints: constraints,
    planPatch,
    answer:
      `Plano sugerido para o período ${planPatch.periodIndex}: ${planPatch.achievedChs} CHS (${classesSummary}). ` +
      `Meta: ${planPatch.targetChs} CHS. Saldo acadêmico atual restante: ~${missingChs} CHS. ` +
      "Clique em 'Aplicar plano sugerido' para atualizar a distribuição desse período.\n\n" +
      buildOfficialSourcesBlock(gradeOptions) +
      selectedTracksNote(selectedTrackLabels)
  };
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const message = body.message.trim();
    const roadmap = body.roadmap as RoadmapResult | undefined;
    const parsedTranscript = body.parsedTranscript as ParsedTranscript | undefined;
    const gradeOptions = body.gradeOptions as GradeOptionsResponse | undefined;
    const selectedTrackLabels = body.selectedTrackLabels;
    const matrixCode = (body.matrixCode ?? roadmap?.matrixCode ?? "981") as MatrixCode;
    const selectedPeriodIndex = body.selectedPeriodIndex ?? 1;
    const fallbackChs = body.maxChsPerPeriod ?? gradeOptions?.graduationPlan.targetChsPerPeriod ?? 18;
    const lower = message.toLowerCase();

    if (!roadmap) {
      return NextResponse.json({
        detectedIntent: "GENERAL_HELP",
        answer: "Para usar o assistente de grade, primeiro processe seu histórico e calcule o roadmap."
      } satisfies AssistantChatResponse);
    }

    let response: AssistantChatResponse;
    const aiDecision = await analyzeIntentWithFallback({ message, matrixCode, fallbackChs });
    const aiAnalysis = aiDecision.analysis;

    const asksGraduation =
      /quanto tempo|qnt tempo|quando formo|previs[aã]o|14\s*chs|chs\/semestre|semestre off|pausa/.test(lower);
    const asksTrackIa = /trilha.*\bia\b|intelig[eê]ncia artificial|\bia\b/.test(lower);
    const asksSchedule =
      /montar grade|organizar grade|sugerir grade|melhor(es)? mat[eé]rias|trabalh|hor[aá]rio|periodo/.test(lower);
    const asksAvailable = /mat[eé]rias dispon[ií]veis|turmas dispon[ií]veis|o que posso pegar/.test(lower);
    const asksRoleAndSources =
      /papel|como voc[eê] funciona|como a ia funciona|fontes|links oficiais|dados que voc[eê] usa|dados usados/.test(lower);

    const intentFromAi = aiAnalysis?.intent;
    const asksTrackIaFinal = intentFromAi ? intentFromAi === "TRACK_IA" : asksTrackIa;
    const asksScheduleFinal = intentFromAi ? intentFromAi === "PLAN_SCHEDULE" : asksSchedule;
    const asksGraduationFinal = intentFromAi ? intentFromAi === "GRADUATION_ESTIMATE" : asksGraduation;
    const asksAvailableFinal = intentFromAi ? intentFromAi === "AVAILABLE_DISCIPLINES" : asksAvailable;

    if (asksRoleAndSources) {
      response = answerAssistantRoleAndData({
        roadmap,
        parsedTranscript,
        gradeOptions,
        matrixCode,
        selectedTrackLabels
      });
    } else if (asksTrackIaFinal) {
      response = answerIaTrack(roadmap);
    } else if (asksScheduleFinal) {
      const periodFromMessage = lower.match(/per[ií]odo\s*(\d{1,2})/);
      const periodIndex = periodFromMessage ? Math.max(1, Math.min(20, Number(periodFromMessage[1]))) : selectedPeriodIndex;
      response = answerSchedulePlan({
        roadmap,
        parsedTranscript,
        gradeOptions,
        message,
        periodIndex,
        fallbackChs,
        overrideConstraints: aiAnalysis?.constraints,
        selectedTrackLabels
      });
    } else if (asksGraduationFinal) {
      response = estimateGraduationAnswer({
        roadmap,
        parsedTranscript,
        message,
        gradeOptions,
        fallbackChs,
        overrideConstraints: aiAnalysis?.constraints
      });
    } else if (asksAvailableFinal) {
      response = answerAvailableDisciplines(gradeOptions, selectedTrackLabels);
    } else {
      response = {
        detectedIntent: "GENERAL_HELP",
        answer:
          `Sou seu assistente de planejamento (${matrixCode}). Meu papel é transformar suas restrições reais em um plano executável, sempre usando oferta oficial do GradeNaHora e referência institucional da UTFPR.\n\n` +
          "Posso: 1) montar grade com restrições de horário; 2) estimar formatura por CHS/off; 3) listar disciplinas da trilha IA liberadas; 4) explicar faltantes por período.\n\n" +
          buildOfficialSourcesBlock(gradeOptions) +
          selectedTracksNote(selectedTrackLabels)
      };
    }

    response.providerUsed = aiAnalysis?.providerUsed ?? aiDecision.providerUsed;
    response.diagnostics = aiDecision.diagnostics;

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Payload inválido para o assistente.",
          issues: error.issues
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Falha no assistente de grade.",
        details: (error as Error).message
      },
      { status: 500 }
    );
  }
}
