import type {
  CurriculumMatrix,
  DisciplineCategory,
  GraduationPlan,
  GraduationPlanPeriod,
  GradeHora,
  GradeDiscipline,
  GradeNaHoraCourse,
  GradeOptionsResponse,
  GradeTurma,
  MatrixCode,
  PlanAgendaEntry,
  PlanPeriodDiscipline,
  ScheduleCombination,
  ScheduledClass
} from "@/types/academic";
import { loadMatrixCatalogByCode } from "@/lib/domain/matrix-catalog";
import { loadCurriculumMatrix } from "@/lib/domain/matriz-engine";
import { fetchGradeNaHoraCourse } from "@/lib/integrations/gradenahora-client";
import { normalizeDisciplineCode } from "@/lib/utils/academic";

const MAX_COMBINATIONS = 20;
const MAX_DISCIPLINES_FOR_BACKTRACK = 6;
const DEFAULT_TARGET_CHS_PER_PERIOD = 18;
const MAX_PLAN_PERIODS = 20;
const SYNTHETIC_ELECTIVE_PENDING_PATTERN = /^ELVP(\d{3})C(\d{3})$/i;
const SYNTHETIC_ELECTIVE_DEFAULT_PERIOD = 8;
const CATALOG_ELECTIVE_GROUPS = new Set(["1171"]);

interface AvailableDiscipline {
  code: string;
  name: string;
  turmas: GradeTurma[];
  credits: number | null;
}

interface PlannedDiscipline {
  code: string;
  name: string;
  category: DisciplineCategory;
  recommendedPeriod?: number;
  cht: number;
  prerequisites: string[];
}

export function buildSemesterCandidates(reference = new Date(), maxItems = 10): string[] {
  const candidates: string[] = [];
  let year = reference.getFullYear();
  let semester: 1 | 2 = reference.getMonth() <= 5 ? 1 : 2;

  while (candidates.length < maxItems) {
    candidates.push(`${year}-${semester}`);
    if (semester === 1) {
      semester = 2;
      year -= 1;
    } else {
      semester = 1;
    }
  }

  return candidates;
}

export async function findLatestAvailableSemester(
  campus: string,
  course: string,
  candidates = buildSemesterCandidates()
): Promise<{ semester: string; payload: GradeNaHoraCourse; warnings: string[] }> {
  const warnings: string[] = [];

  for (const semester of candidates) {
    try {
      const result = await fetchGradeNaHoraCourse(semester, campus, course);
      return {
        semester: result.semester,
        payload: result.course,
        warnings
      };
    } catch (error) {
      warnings.push(`Semestre ${semester} indisponível (${(error as Error).message}).`);
    }
  }

  throw new Error("Nenhum semestre disponível no GradeNaHora para o curso/campus informado.");
}

function includeTurmaForMatrix(turma: GradeTurma, matrixCode: MatrixCode): boolean {
  if (!Array.isArray(turma.optativa_matrizes) || turma.optativa_matrizes.length === 0) {
    return true;
  }
  const normalized = turma.optativa_matrizes.map((item) => item.replace(/\s+/g, "").toLowerCase());
  return normalized.includes(`matriz:${matrixCode}`.toLowerCase());
}

export function filterDisciplinesForRoadmap(
  coursePayload: GradeNaHoraCourse,
  matrixCode: MatrixCode,
  requestedCodes: string[]
): AvailableDiscipline[] {
  const normalizedRequested = new Set(requestedCodes.map((item) => item.toUpperCase().trim()));

  return coursePayload.disciplinas
    .filter((discipline) => normalizedRequested.size === 0 || normalizedRequested.has(discipline.codigo.toUpperCase()))
    .map((discipline) => ({
      code: discipline.codigo.toUpperCase(),
      name: discipline.nome,
      credits: discipline.creditos,
      turmas: discipline.turmas.filter((turma) => includeTurmaForMatrix(turma, matrixCode))
    }))
    .filter((discipline) => discipline.turmas.length > 0)
    .sort((a, b) => a.code.localeCompare(b.code));
}

function turmaConflict(existing: ScheduledClass[], candidate: GradeTurma): boolean {
  const busySlots = new Set(existing.flatMap((item) => item.horarios.map((h) => h.horario.toUpperCase())));
  return candidate.horarios.some((slot) => busySlots.has(slot.horario.toUpperCase()));
}

function makeScheduledClass(discipline: { code: string; name: string; credits: number | null }, turma: GradeTurma): ScheduledClass {
  return {
    disciplineCode: discipline.code,
    disciplineName: discipline.name,
    classCode: turma.codigo,
    horarios: turma.horarios,
    professores: turma.professores,
    weeklyCredits: discipline.credits
  };
}

export function buildScheduleCombinations(
  available: AvailableDiscipline[],
  maxCombinations = MAX_COMBINATIONS
): ScheduleCombination[] {
  const target = available.slice(0, MAX_DISCIPLINES_FOR_BACKTRACK);
  const combinations: ScheduleCombination[] = [];

  function backtrack(index: number, current: ScheduledClass[], conflictAvoided: number): void {
    if (combinations.length >= maxCombinations) {
      return;
    }

    if (index >= target.length) {
      combinations.push({
        classes: [...current],
        weeklyCredits: current.reduce((sum, item) => sum + (item.weeklyCredits ?? 0), 0),
        coveredPendingCodes: current.map((item) => item.disciplineCode),
        conflictCountAvoided: conflictAvoided
      });
      return;
    }

    const discipline = target[index];
    let localConflicts = 0;

    for (const turma of discipline.turmas) {
      if (turmaConflict(current, turma)) {
        localConflicts += 1;
        continue;
      }
      current.push(makeScheduledClass(discipline, turma));
      backtrack(index + 1, current, conflictAvoided + localConflicts);
      current.pop();
    }

    // Permite pular disciplina quando não há encaixe possível.
    backtrack(index + 1, current, conflictAvoided + localConflicts);
  }

  backtrack(0, [], 0);

  return combinations
    .filter((combo) => combo.classes.length > 0)
    .sort((a, b) => {
      if (b.classes.length !== a.classes.length) {
        return b.classes.length - a.classes.length;
      }
      return a.conflictCountAvoided - b.conflictCountAvoided;
    })
    .slice(0, maxCombinations);
}

function estimateChs(cht: number, credits: number | null): number {
  if (typeof credits === "number" && Number.isFinite(credits) && credits > 0) {
    return credits;
  }
  return Math.max(1, Math.round(cht / 15));
}

function decodeHorarioCode(code: string): { dayLabel: string; shiftLabel: string; slot: string } {
  const trimmed = code.trim().toUpperCase();
  const match = trimmed.match(/^([2-7])([MTN])(\d+)$/);
  if (!match) {
    return { dayLabel: "Outro", shiftLabel: "Indefinido", slot: trimmed };
  }

  const dayMap: Record<string, string> = {
    "2": "Segunda",
    "3": "Terça",
    "4": "Quarta",
    "5": "Quinta",
    "6": "Sexta",
    "7": "Sábado"
  };
  const shiftMap: Record<string, string> = {
    M: "Manhã",
    T: "Tarde",
    N: "Noite"
  };

  return {
    dayLabel: dayMap[match[1]] ?? "Outro",
    shiftLabel: shiftMap[match[2]] ?? "Indefinido",
    slot: `${match[2]}${match[3]}`
  };
}

function turmaConflictsWithSlots(usedSlots: Set<string>, turma: GradeTurma): boolean {
  return turma.horarios.some((slot) => usedSlots.has(slot.horario.toUpperCase()));
}

function selectTurmaWithoutConflict(turmas: GradeTurma[], usedSlots: Set<string>): GradeTurma | undefined {
  return [...turmas]
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
    .find((turma) => !turmaConflictsWithSlots(usedSlots, turma));
}

function sortByPeriodAndCode(a: { recommendedPeriod?: number; code: string }, b: { recommendedPeriod?: number; code: string }): number {
  return (a.recommendedPeriod ?? 99) - (b.recommendedPeriod ?? 99) || a.code.localeCompare(b.code);
}

function makeAgendaEntries(disciplines: PlanPeriodDiscipline[]): PlanAgendaEntry[] {
  const entries: PlanAgendaEntry[] = [];

  for (const discipline of disciplines) {
    if (!discipline.scheduled) {
      continue;
    }

    for (const horario of discipline.horarios) {
      const decoded = decodeHorarioCode(horario.horario);
      entries.push({
        dayLabel: decoded.dayLabel,
        shiftLabel: decoded.shiftLabel,
        slot: decoded.slot,
        code: horario.horario,
        disciplineCode: discipline.code,
        disciplineName: discipline.name,
        classCode: discipline.classCode,
        room: horario.sala
      });
    }
  }

  return entries.sort((a, b) => {
    const day = a.dayLabel.localeCompare(b.dayLabel);
    if (day !== 0) {
      return day;
    }
    const shift = a.shiftLabel.localeCompare(b.shiftLabel);
    if (shift !== 0) {
      return shift;
    }
    const slot = a.slot.localeCompare(b.slot);
    if (slot !== 0) {
      return slot;
    }
    return a.disciplineCode.localeCompare(b.disciplineCode);
  });
}

function parseSyntheticElectivePendingCode(code: string): PlannedDiscipline | undefined {
  const normalized = normalizeDisciplineCode(code);
  const match = normalized.match(SYNTHETIC_ELECTIVE_PENDING_PATTERN);
  if (!match) {
    return undefined;
  }

  const sequence = Number(match[1]);
  const cht = Number(match[2]);
  if (!Number.isFinite(cht) || cht <= 0) {
    return undefined;
  }

  return {
    code: normalized,
    name: `Eletiva Livre Pendente ${Number.isFinite(sequence) && sequence > 0 ? sequence : 1}`,
    category: "ELECTIVE",
    recommendedPeriod: SYNTHETIC_ELECTIVE_DEFAULT_PERIOD,
    cht,
    prerequisites: []
  };
}

export function buildGraduationPlan(params: {
  matrix: CurriculumMatrix;
  pendingCodes: string[];
  available: AvailableDiscipline[];
  targetChsPerPeriod: number;
  maxPeriods?: number;
}): GraduationPlan {
  const { matrix, available, maxPeriods = MAX_PLAN_PERIODS } = params;
  const targetChsPerPeriod = Math.max(1, Math.floor(params.targetChsPerPeriod || DEFAULT_TARGET_CHS_PER_PERIOD));

  const disciplineMap = new Map<string, PlannedDiscipline>(
    matrix.disciplines.map((discipline) => [
      normalizeDisciplineCode(discipline.code),
      {
        code: normalizeDisciplineCode(discipline.code),
        name: discipline.name,
        category: discipline.category,
        recommendedPeriod: discipline.recommendedPeriod,
        cht: discipline.cht,
        prerequisites: discipline.prerequisites.map((prereq) => normalizeDisciplineCode(prereq))
      }
    ])
  );
  const availableMap = new Map(available.map((item) => [normalizeDisciplineCode(item.code), item]));
  const warnings: string[] = [];

  const pendingCodes = [...new Set(params.pendingCodes.map((code) => normalizeDisciplineCode(code)).filter(Boolean))];
  const remaining = new Set<string>();

  for (const code of pendingCodes) {
    if (disciplineMap.has(code)) {
      remaining.add(code);
      continue;
    }

    const syntheticElective = parseSyntheticElectivePendingCode(code);
    if (syntheticElective) {
      disciplineMap.set(code, syntheticElective);
      remaining.add(code);
    } else {
      warnings.push(`Código pendente ${code} não encontrado na matriz ${matrix.matrixCode}.`);
    }
  }

  const totalMissingCht = [...remaining].reduce((sum, code) => sum + (disciplineMap.get(code)?.cht ?? 0), 0);
  const totalMissingEstimatedChs = [...remaining].reduce((sum, code) => {
    const discipline = disciplineMap.get(code);
    if (!discipline) {
      return sum;
    }
    const offered = availableMap.get(code);
    return sum + estimateChs(discipline.cht, offered?.credits ?? null);
  }, 0);

  const periods: GraduationPlanPeriod[] = [];

  while (remaining.size > 0 && periods.length < maxPeriods) {
    const eligible = [...remaining]
      .map((code) => disciplineMap.get(code))
      .filter((discipline): discipline is NonNullable<typeof discipline> => Boolean(discipline))
      .filter((discipline) => discipline.prerequisites.every((prereq) => !remaining.has(normalizeDisciplineCode(prereq))))
      .sort(sortByPeriodAndCode);

    if (eligible.length === 0) {
      warnings.push("Não foi possível avançar no plano: há dependências circulares ou pré-requisitos externos não resolvidos.");
      break;
    }

    const selected: PlanPeriodDiscipline[] = [];
    const usedSlots = new Set<string>();
    let accumulatedChs = 0;

    for (const discipline of eligible) {
      const code = normalizeDisciplineCode(discipline.code);
      const offered = availableMap.get(code);
      const estimatedChs = estimateChs(discipline.cht, offered?.credits ?? null);

      if (selected.length > 0 && accumulatedChs + estimatedChs > targetChsPerPeriod) {
        continue;
      }

      const selectedTurma = offered ? selectTurmaWithoutConflict(offered.turmas, usedSlots) : undefined;

      if (offered && offered.turmas.length > 0 && !selectedTurma) {
        // Todas as turmas conflitam com as já escolhidas neste período.
        continue;
      }

      const horarios: GradeHora[] = selectedTurma?.horarios ?? [];
      for (const slot of horarios) {
        usedSlots.add(slot.horario.toUpperCase());
      }

      selected.push({
        code,
        name: discipline.name,
        category: discipline.category,
        recommendedPeriod: discipline.recommendedPeriod,
        cht: discipline.cht,
        estimatedChs,
        classCode: selectedTurma?.codigo,
        scheduled: Boolean(selectedTurma),
        horarios,
        professores: selectedTurma?.professores ?? [],
        note: selectedTurma ? undefined : "Sem turma disponível no semestre base do GradeNaHora."
      });
      accumulatedChs += estimatedChs;
    }

    if (selected.length === 0) {
      const fallback = eligible[0];
      const code = normalizeDisciplineCode(fallback.code);
      const offered = availableMap.get(code);
      const selectedTurma = offered?.turmas[0];
      const estimatedChs = estimateChs(fallback.cht, offered?.credits ?? null);
      const horarios = selectedTurma?.horarios ?? [];

      selected.push({
        code,
        name: fallback.name,
      category: fallback.category,
        recommendedPeriod: fallback.recommendedPeriod,
        cht: fallback.cht,
        estimatedChs,
        classCode: selectedTurma?.codigo,
        scheduled: Boolean(selectedTurma),
        horarios,
        professores: selectedTurma?.professores ?? [],
        note: selectedTurma
          ? "Alocada por fallback do planejador."
          : "Sem turma disponível no semestre base do GradeNaHora."
      });
      accumulatedChs += estimatedChs;

      if (estimatedChs > targetChsPerPeriod) {
        warnings.push(`A disciplina ${code} excede o limite informado de ${targetChsPerPeriod} CHS por período.`);
      }
    }

    for (const item of selected) {
      remaining.delete(item.code);
    }

    const sortedDisciplines = selected.sort(sortByPeriodAndCode);
    const scheduledEstimatedChs = sortedDisciplines
      .filter((discipline) => discipline.scheduled)
      .reduce((sum, discipline) => sum + discipline.estimatedChs, 0);
    const unscheduledEstimatedChs = sortedDisciplines
      .filter((discipline) => !discipline.scheduled)
      .reduce((sum, discipline) => sum + discipline.estimatedChs, 0);

    periods.push({
      periodIndex: periods.length + 1,
      totalEstimatedChs: sortedDisciplines.reduce((sum, discipline) => sum + discipline.estimatedChs, 0),
      totalCht: sortedDisciplines.reduce((sum, discipline) => sum + discipline.cht, 0),
      scheduledEstimatedChs,
      unscheduledEstimatedChs,
      disciplines: sortedDisciplines,
      agenda: makeAgendaEntries(sortedDisciplines)
    });
  }

  const remainingCodes = [...remaining].sort();
  const remainingMissingCht = remainingCodes.reduce((sum, code) => sum + (disciplineMap.get(code)?.cht ?? 0), 0);
  const remainingMissingEstimatedChs = remainingCodes.reduce((sum, code) => {
    const discipline = disciplineMap.get(code);
    if (!discipline) {
      return sum;
    }
    const offered = availableMap.get(code);
    return sum + estimateChs(discipline.cht, offered?.credits ?? null);
  }, 0);

  if (remainingCodes.length > 0) {
    warnings.push(`Plano parcial: ${remainingCodes.length} disciplina(s) permaneceram sem alocação por limite de períodos.`);
  }

  return {
    targetChsPerPeriod,
    totalMissingCht,
    totalMissingEstimatedChs,
    periods,
    remainingCodes,
    remainingMissingCht,
    remainingMissingEstimatedChs,
    warnings
  };
}

export async function buildGradeOptions(params: {
  matrixCode: MatrixCode;
  campus: string;
  course: string;
  requestedCodes: string[];
  maxChsPerPeriod?: number;
}): Promise<GradeOptionsResponse> {
  const { matrixCode, campus, course, requestedCodes, maxChsPerPeriod } = params;

  const inputRequestedCodes = [...new Set(requestedCodes.map((code) => normalizeDisciplineCode(code)).filter(Boolean))];
  const syntheticElectivePending = inputRequestedCodes
    .map((code) => {
      const match = code.match(SYNTHETIC_ELECTIVE_PENDING_PATTERN);
      if (!match) {
        return null;
      }
      return Number(match[2]);
    })
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
  const syntheticElectiveRequiredCht = syntheticElectivePending.reduce((sum, value) => sum + value, 0);

  let normalizedRequestedCodes = inputRequestedCodes.filter((code) => !SYNTHETIC_ELECTIVE_PENDING_PATTERN.test(code));
  const replacementWarnings: string[] = [];

  if (syntheticElectiveRequiredCht > 0) {
    const catalogByCode = await loadMatrixCatalogByCode(matrixCode);
    const electiveCandidates = [...catalogByCode.values()]
      .filter((discipline) => {
        const code = normalizeDisciplineCode(discipline.code);
        if (!code) return false;
        const byCode = code.startsWith("ELE");
        const byGroup = discipline.optGroup ? CATALOG_ELECTIVE_GROUPS.has(discipline.optGroup) : false;
        return byCode || byGroup;
      })
      .sort((a, b) => (a.period ?? 99) - (b.period ?? 99) || a.code.localeCompare(b.code));

    const selected: string[] = [];
    let accumulated = 0;
    for (const candidate of electiveCandidates) {
      const code = normalizeDisciplineCode(candidate.code);
      if (!code || normalizedRequestedCodes.includes(code) || selected.includes(code)) {
        continue;
      }
      selected.push(code);
      accumulated += Math.max(candidate.cht ?? 0, 0);
      if (accumulated >= syntheticElectiveRequiredCht) {
        break;
      }
    }

    if (selected.length > 0) {
      normalizedRequestedCodes = [...new Set([...normalizedRequestedCodes, ...selected])];
      replacementWarnings.push(
        `Pendências sintéticas de eletiva (ELVP) substituídas por eletivas reais: ${selected.join(", ")}.`
      );
    } else {
      // fallback conservador: mantém os códigos sintéticos quando não há catálogo para substituir
      normalizedRequestedCodes = inputRequestedCodes;
      replacementWarnings.push(
        "Não foi possível substituir ELVP por eletivas reais; mantendo pendências sintéticas para não perder planejamento."
      );
    }
  }

  const { semester, payload, warnings } = await findLatestAvailableSemester(campus, course);
  const matrix = await loadCurriculumMatrix(matrixCode);
  const availableByDiscipline = filterDisciplinesForRoadmap(payload, matrixCode, normalizedRequestedCodes);
  const combinations = buildScheduleCombinations(availableByDiscipline);
  const graduationPlan = buildGraduationPlan({
    matrix,
    pendingCodes: normalizedRequestedCodes,
    available: availableByDiscipline,
    targetChsPerPeriod: maxChsPerPeriod ?? DEFAULT_TARGET_CHS_PER_PERIOD
  });

  return {
    matrixCode,
    campus,
    course,
    semesterUsed: semester,
    lastUpdate: payload.ultima_atualizacao,
    requestedCodes: normalizedRequestedCodes,
    availableByDiscipline: availableByDiscipline.map((item) => ({
      code: item.code,
      name: item.name,
      credits: item.credits,
      turmas: item.turmas
    })),
    combinations,
    graduationPlan,
    warnings: [...warnings, ...replacementWarnings, ...graduationPlan.warnings]
  };
}

export function extractUniqueRequestedCodes(input: string | null): string[] {
  if (!input) {
    return [];
  }

  return [...new Set(input
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean))];
}

export function disciplineCodesFromPayload(payload: GradeDiscipline[]): string[] {
  return [...new Set(payload.map((discipline) => discipline.codigo.toUpperCase()))];
}
