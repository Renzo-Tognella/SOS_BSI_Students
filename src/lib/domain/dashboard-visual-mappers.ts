import type {
  ParsedTranscript,
  PrereqGraphNode,
  RoadmapResult,
  TranscriptAttempt
} from "@/types/academic";
import type {
  AcademicEventItem,
  DashboardSeriesPoint,
  DashboardVisualModel,
  SubjectRoadmapItem,
  SubjectRoadmapState
} from "@/types/dashboard";

interface PlannerAgendaEntry {
  code: string;
  name: string;
  turma?: string;
  horario: string;
  sala?: string;
}

interface PlannerPeriodSnapshot {
  periodIndex: number;
  totalChs: number;
  totalCht: number;
  disciplines: Array<{
    code: string;
    name: string;
    cht: number;
  }>;
  agenda: PlannerAgendaEntry[];
}

export interface ManualPlannerVisualInput {
  periods: PlannerPeriodSnapshot[];
  unassigned: Array<{
    code: string;
    name: string;
    cht: number;
  }>;
}

export interface BuildDashboardVisualModelInput {
  roadmap: RoadmapResult;
  parsedTranscript: ParsedTranscript | null;
  manualPlannerData: ManualPlannerVisualInput | null;
  missingCht: number;
  missingChs: number;
  missingChext: number;
}

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sortAttempts(a: TranscriptAttempt, b: TranscriptAttempt): number {
  const aYear = a.year ?? 0;
  const bYear = b.year ?? 0;
  if (aYear !== bYear) {
    return aYear - bYear;
  }

  const aSemester = a.semester ?? 0;
  const bSemester = b.semester ?? 0;
  return aSemester - bSemester;
}

function semesterLabel(year?: number | null, semester?: number | null): string | null {
  if (!year || !semester) {
    return null;
  }

  return `${year}-${semester}`;
}

function statusToRoadmapState(node: PrereqGraphNode, attempts: TranscriptAttempt[]): SubjectRoadmapState {
  if (node.status === "DONE") {
    return "COMPLETED";
  }

  if (attempts.some((attempt) => attempt.status === "IN_PROGRESS")) {
    return "IN_PROGRESS";
  }

  if (node.status === "AVAILABLE") {
    return "AVAILABLE";
  }

  return "LOCKED";
}

function subjectStatePriority(state: SubjectRoadmapState): number {
  if (state === "IN_PROGRESS") return 0;
  if (state === "AVAILABLE") return 1;
  if (state === "LOCKED") return 2;
  return 3;
}

function getRecentScores(attempts: TranscriptAttempt[]): number[] {
  return attempts
    .filter((attempt) => typeof attempt.average === "number" && Number.isFinite(attempt.average))
    .sort((a, b) => sortAttempts(a, b))
    .slice(-3)
    .map((attempt) => Number(attempt.average?.toFixed(1) ?? 0));
}

function getLatestAverage(attempts: TranscriptAttempt[]): number | null {
  const graded = attempts
    .filter((attempt) => typeof attempt.average === "number" && Number.isFinite(attempt.average))
    .sort((a, b) => sortAttempts(a, b));

  const latest = graded.at(-1);
  return latest ? Number((latest.average ?? 0).toFixed(1)) : null;
}

function compareSemesterLabel(a: string, b: string): number {
  const [aYear, aSemester] = a.split("-").map((value) => Number(value));
  const [bYear, bSemester] = b.split("-").map((value) => Number(value));

  if (aYear !== bYear) {
    return aYear - bYear;
  }
  return aSemester - bSemester;
}

function buildPerformanceVelocity(attempts: TranscriptAttempt[]): {
  performanceVelocity: DashboardSeriesPoint[];
  projectedVelocity: DashboardSeriesPoint[];
  averageGrade: number | null;
  averageGradeDelta: number;
  streakDays: number;
} {
  const bySemester = new Map<string, number[]>();

  for (const attempt of attempts) {
    const label = semesterLabel(attempt.year, attempt.semester);
    if (!label) {
      continue;
    }

    if (typeof attempt.average !== "number" || !Number.isFinite(attempt.average)) {
      continue;
    }

    const values = bySemester.get(label) ?? [];
    values.push(attempt.average);
    bySemester.set(label, values);
  }

  const performanceVelocity = [...bySemester.entries()]
    .sort((a, b) => compareSemesterLabel(a[0], b[0]))
    .map(([label, values]) => {
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      return {
        label,
        value: Number(average.toFixed(2))
      };
    });

  const averageGrade =
    performanceVelocity.length > 0
      ? Number((performanceVelocity.reduce((sum, point) => sum + point.value, 0) / performanceVelocity.length).toFixed(2))
      : null;

  let averageGradeDelta = 0;
  if (performanceVelocity.length >= 2) {
    averageGradeDelta = Number(
      (performanceVelocity[performanceVelocity.length - 1].value - performanceVelocity[performanceVelocity.length - 2].value).toFixed(2)
    );
  }

  const projectedVelocity: DashboardSeriesPoint[] = [];
  if (performanceVelocity.length > 0) {
    const baseline = performanceVelocity.at(-1)?.value ?? 0;
    const start = performanceVelocity[Math.max(0, performanceVelocity.length - 3)]?.value ?? baseline;
    const steps = Math.max(1, Math.min(performanceVelocity.length - 1, 2));
    const slope = (baseline - start) / steps;

    const [lastYear, lastSemester] = (performanceVelocity.at(-1)?.label ?? "2026-1").split("-").map((value) => Number(value));
    let currentYear = Number.isFinite(lastYear) ? lastYear : new Date().getFullYear();
    let currentSemester = Number.isFinite(lastSemester) ? lastSemester : 1;

    for (let index = 1; index <= 4; index += 1) {
      if (currentSemester === 1) {
        currentSemester = 2;
      } else {
        currentSemester = 1;
        currentYear += 1;
      }

      projectedVelocity.push({
        label: `${currentYear}-${currentSemester}`,
        value: Number(clamp(baseline + slope * index, 4, 10).toFixed(2))
      });
    }
  }

  const approvedLabels = attempts
    .filter((attempt) => attempt.status === "APPROVED")
    .map((attempt) => semesterLabel(attempt.year, attempt.semester))
    .filter((value): value is string => Boolean(value));

  const uniqueApprovedLabels = [...new Set(approvedLabels)].sort(compareSemesterLabel);
  let streakSemesters = 0;
  for (let index = uniqueApprovedLabels.length - 1; index >= 0; index -= 1) {
    if (index === uniqueApprovedLabels.length - 1) {
      streakSemesters += 1;
      continue;
    }

    const [currentYear, currentSemester] = uniqueApprovedLabels[index + 1].split("-").map((value) => Number(value));
    const [previousYear, previousSemester] = uniqueApprovedLabels[index].split("-").map((value) => Number(value));

    const expectedPreviousYear = currentSemester === 1 ? currentYear - 1 : currentYear;
    const expectedPreviousSemester = currentSemester === 1 ? 2 : 1;

    if (previousYear === expectedPreviousYear && previousSemester === expectedPreviousSemester) {
      streakSemesters += 1;
    } else {
      break;
    }
  }

  return {
    performanceVelocity,
    projectedVelocity,
    averageGrade,
    averageGradeDelta,
    streakDays: streakSemesters * 30
  };
}

function parseScheduleCode(code: string): { day: number; shift: "M" | "T" | "N"; slot: number; duration: number } | null {
  const match = code.trim().toUpperCase().match(/^([2-7])([MTN])(\d+)$/);
  if (!match) {
    return null;
  }

  const slotDigits = match[3];
  const slot = Number(slotDigits[0]);
  if (!Number.isFinite(slot) || slot < 1) {
    return null;
  }

  return {
    day: Number(match[1]),
    shift: match[2] as "M" | "T" | "N",
    slot,
    duration: Math.max(slotDigits.length, 1)
  };
}

function slotToHour(shift: "M" | "T" | "N", slot: number): number {
  const baseByShift = { M: 7, T: 13, N: 19 };
  return baseByShift[shift] + clamp(slot - 1, 0, 5);
}

function resolveNextOccurrence(parsed: { day: number; shift: "M" | "T" | "N"; slot: number }, now: Date): Date {
  const jsTargetDay = parsed.day - 1;
  const currentDay = now.getDay();
  const hour = slotToHour(parsed.shift, parsed.slot);

  let deltaDays = jsTargetDay - currentDay;
  if (deltaDays < 0) {
    deltaDays += 7;
  }

  const scheduled = new Date(now);
  scheduled.setDate(now.getDate() + deltaDays);
  scheduled.setHours(hour, 0, 0, 0);

  if (scheduled.getTime() <= now.getTime()) {
    scheduled.setDate(scheduled.getDate() + 7);
  }

  return scheduled;
}

function formatCountdown(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    return "Agora";
  }

  const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
  if (diffHours < 24) {
    return `Em ${diffHours}h`;
  }

  const diffDays = Math.ceil(diffHours / 24);
  return `Em ${diffDays} dia${diffDays > 1 ? "s" : ""}`;
}

function buildLiveEvents(
  manualPlannerData: ManualPlannerVisualInput | null,
  subjectsByCode: Map<string, SubjectRoadmapItem>
): AcademicEventItem[] {
  if (!manualPlannerData) {
    return [];
  }

  const now = new Date();
  const events: AcademicEventItem[] = [];

  for (const period of manualPlannerData.periods) {
    for (const agenda of period.agenda) {
      const parsed = parseScheduleCode(agenda.horario);
      if (!parsed) {
        continue;
      }

      const startsAt = resolveNextOccurrence(parsed, now);
      const subject = subjectsByCode.get(agenda.code);

      events.push({
        id: `${period.periodIndex}-${agenda.code}-${agenda.horario}-${agenda.turma ?? "T"}`,
        title: `${agenda.code} · ${agenda.name}`,
        subtitle: `Turma ${agenda.turma ?? "-"} · Sala ${agenda.sala ?? "-"}`,
        subjectCode: agenda.code,
        type: "live",
        startsAt: startsAt.toISOString(),
        countdownLabel: formatCountdown(startsAt, now),
        preparationPercent: clamp(subject?.completionPercent ?? 30, 15, 100),
        completed: false
      });
    }
  }

  return events.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()).slice(0, 14);
}

function buildStudyDistribution(manualPlannerData: ManualPlannerVisualInput | null): DashboardVisualModel["studyDistribution"] {
  const baseHours = new Map<number, number>();
  for (let index = 0; index < 7; index += 1) {
    baseHours.set(index, 0);
  }

  if (manualPlannerData) {
    for (const period of manualPlannerData.periods) {
      for (const agenda of period.agenda) {
        const parsed = parseScheduleCode(agenda.horario);
        if (!parsed) {
          continue;
        }

        const jsDay = parsed.day - 1;
        const current = baseHours.get(jsDay) ?? 0;
        baseHours.set(jsDay, current + parsed.duration);
      }
    }
  }

  const maxHours = Math.max(...baseHours.values(), 1);

  return WEEKDAY_SHORT.map((day, dayIndex) => {
    const hours = baseHours.get(dayIndex) ?? 0;
    const intensity = Math.round((hours / maxHours) * 4);

    return {
      day,
      hours,
      intensity
    };
  });
}

function buildSkillsRadar(roadmap: RoadmapResult): DashboardVisualModel["skillsRadar"] {
  const progressByKey = new Map(roadmap.progress.map((bucket) => [bucket.key, bucket]));
  type ProgressKey = RoadmapResult["progress"][number]["key"];

  const ratio = (key: ProgressKey): number => {
    const bucket = progressByKey.get(key);
    if (!bucket || bucket.requiredCHT <= 0) {
      return 0;
    }
    return clamp(Math.round((bucket.validatedCHT / bucket.requiredCHT) * 100), 0, 100);
  };

  const labels = ["Lógica", "Prática", "Teoria", "Projeto", "Equipe"];
  const student = [
    ratio("mandatory"),
    Math.round((ratio("optional") + ratio("elective")) / 2),
    Math.round((ratio("mandatory") + ratio("optional")) / 2),
    Math.round((ratio("internship") + ratio("tcc")) / 2),
    ratio("complementary")
  ];

  const baseline = student.reduce((sum, value) => sum + value, 0) / labels.length;
  const cohortReference = student.map((value, index) => clamp(Math.round((value + baseline + 12 + index * 3) / 2), 30, 92));

  return {
    labels,
    student,
    cohortReference
  };
}

function buildSuggestions(model: {
  missingChs: number;
  availableSubjects: number;
  blockedSubjects: number;
  eventsCount: number;
  nextMilestone: string;
  streakDays: number;
}): string[] {
  const suggestions: string[] = [];

  if (model.missingChs > 40) {
    suggestions.push(`Carga restante alta (${model.missingChs} CHS). Priorize disciplinas obrigatórias liberadas.`);
  }

  if (model.availableSubjects > 0) {
    suggestions.push(`Você tem ${model.availableSubjects} disciplina(s) liberada(s) para avançar neste ciclo.`);
  }

  if (model.blockedSubjects > 0) {
    suggestions.push(`${model.blockedSubjects} disciplina(s) ainda bloqueada(s). Foque no próximo pré-requisito: ${model.nextMilestone}.`);
  }

  if (model.eventsCount === 0) {
    suggestions.push("Sem eventos acadêmicos datados. Use o planejador para montar agenda e ganhar previsibilidade.");
  }

  if (model.streakDays > 0 && model.streakDays < 90) {
    suggestions.push("Mantenha consistência: uma revisão curta por semana já ajuda a estabilizar a média.");
  }

  return suggestions.slice(0, 3);
}

export function buildDashboardVisualModel({
  roadmap,
  parsedTranscript,
  manualPlannerData,
  missingCht,
  missingChs,
  missingChext
}: BuildDashboardVisualModelInput): DashboardVisualModel {
  const attempts = parsedTranscript?.attempts ?? [];
  const attemptsByCode = new Map<string, TranscriptAttempt[]>();
  for (const attempt of attempts) {
    const key = attempt.code.trim().toUpperCase();
    const group = attemptsByCode.get(key) ?? [];
    group.push(attempt);
    attemptsByCode.set(key, group);
  }

  const subjects = roadmap.prereqGraph.nodes
    .filter((node) => node.status !== "OUTSIDE_SCOPE")
    .map((node) => {
      const nodeAttempts = attemptsByCode.get(node.code.trim().toUpperCase()) ?? [];
      const state = statusToRoadmapState(node, nodeAttempts);

      return {
        code: node.code,
        name: node.name,
        period: node.recommendedPeriod ?? null,
        cht: node.cht,
        state,
        completionPercent:
          state === "COMPLETED" ? 100 : state === "IN_PROGRESS" ? 50 : state === "AVAILABLE" ? 20 : 0,
        prerequisites: node.prerequisites,
        grade: getLatestAverage(nodeAttempts),
        recentScores: getRecentScores(nodeAttempts)
      } satisfies SubjectRoadmapItem;
    })
    .sort((a, b) => {
      const statePriorityDiff = subjectStatePriority(a.state) - subjectStatePriority(b.state);
      if (statePriorityDiff !== 0) {
        return statePriorityDiff;
      }

      const periodA = a.period ?? 99;
      const periodB = b.period ?? 99;
      if (periodA !== periodB) {
        return periodA - periodB;
      }
      return a.code.localeCompare(b.code);
    });

  const progressWithoutChext = roadmap.progress.filter((bucket) => bucket.key !== "extension");
  const totalRequiredCht = progressWithoutChext.reduce((sum, bucket) => sum + bucket.requiredCHT, 0);
  const validatedCht = progressWithoutChext.reduce((sum, bucket) => sum + bucket.validatedCHT, 0);
  const overallProgressPercent = totalRequiredCht > 0 ? Number(((validatedCht / totalRequiredCht) * 100).toFixed(1)) : 0;

  const completedSubjects = subjects.filter((subject) => subject.state === "COMPLETED").length;
  const totalSubjects = subjects.length;

  const nextMilestoneItem =
    subjects.find((subject) => subject.state === "AVAILABLE") ??
    subjects.find((subject) => subject.state === "LOCKED") ??
    null;
  const nextMilestone = nextMilestoneItem
    ? `${nextMilestoneItem.code} - ${nextMilestoneItem.name}`
    : "Concluir itens finais do curso";

  const velocity = buildPerformanceVelocity(attempts);
  const subjectsByCode = new Map(subjects.map((subject) => [subject.code, subject]));
  const events = buildLiveEvents(manualPlannerData, subjectsByCode);
  const nextClassEvent = events.find((event) => event.type === "live") ?? null;

  const nextClass = nextClassEvent
    ? {
        title: nextClassEvent.title,
        subtitle: nextClassEvent.subtitle ?? "Aula ao vivo",
        countdownLabel: nextClassEvent.countdownLabel,
        startsAt: nextClassEvent.startsAt,
        materialCount: 2,
        online: true
      }
    : null;

  const availableSubjects = subjects.filter((subject) => subject.state === "AVAILABLE" || subject.state === "IN_PROGRESS").length;
  const blockedSubjects = subjects.filter((subject) => subject.state === "LOCKED").length;

  return {
    overallProgressPercent,
    completedSubjects,
    totalSubjects,
    streakDays: velocity.streakDays,
    nextMilestone,
    averageGrade: velocity.averageGrade,
    averageGradeDelta: velocity.averageGradeDelta,
    totalStudyHours: validatedCht,
    rankingLabel: "N/D",
    missingCht,
    missingChs,
    missingChext,
    subjects,
    performanceVelocity: velocity.performanceVelocity,
    projectedVelocity: velocity.projectedVelocity,
    skillsRadar: buildSkillsRadar(roadmap),
    studyDistribution: buildStudyDistribution(manualPlannerData),
    events,
    nextClass,
    suggestions: buildSuggestions({
      missingChs,
      availableSubjects,
      blockedSubjects,
      eventsCount: events.length,
      nextMilestone,
      streakDays: velocity.streakDays
    }),
    focusCode: subjects.find((subject) => subject.state === "IN_PROGRESS")?.code ?? subjects.find((subject) => subject.state === "AVAILABLE")?.code ?? null
  };
}

export function getCalendarMonthMatrix(referenceDate: Date): Date[] {
  const firstDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function formatEventDate(isoDate: string): string {
  const date = new Date(isoDate);
  const weekday = WEEKDAY_SHORT[date.getDay()] ?? "Dia";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  return `${weekday}, ${day}/${month} ${hours}h`;
}
