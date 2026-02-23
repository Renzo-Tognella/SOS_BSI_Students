import type {
  GraduationForecast,
  GraduationForecastAudit,
  GraduationForecastMissingSource,
  OfficialTranscriptMissingWorkload,
  ParsedTranscript,
  RoadmapResult
} from "@/types/academic";
import { normalizeDisciplineName } from "@/lib/utils/academic";

const DEFAULT_AVERAGE_CHS = 12;
const DEFAULT_MAX_PROJECTED_SEMESTERS = 20;

export const FORECAST_METHODOLOGY_NOTE =
  "Estimativa considera apenas CHT de disciplinas (obrigatórias/optativas/eletivas). CHEXT e Estágio não foram incluídos nesta projeção.";
export const FORECAST_CHEXT_NOTE = "CHEXT não foi incluído nesta estimativa de semestres.";
export const FORECAST_INTERNSHIP_NOTE = "Estágio não foi incluído nesta estimativa de semestres.";

function isInternshipAttempt(attempt: ParsedTranscript["attempts"][number]): boolean {
  const normalizedName = normalizeDisciplineName(attempt.name ?? "");
  if (normalizedName.includes("estagio")) {
    return true;
  }

  const normalizedStatus = normalizeDisciplineName(attempt.statusText ?? "");
  return normalizedStatus.includes("estagio");
}

export function estimateChsFromCht(cht: number): number {
  return Math.max(1, Math.round(cht / 15));
}

export function semesterLabelToIndex(label: string): number | null {
  const match = label.match(/^(\d{4})-(1|2)$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const semester = Number(match[2]);
  return year * 2 + (semester - 1);
}

export function buildSemesterRange(startLabel: string, endLabel: string): string[] {
  const start = semesterLabelToIndex(startLabel);
  const end = semesterLabelToIndex(endLabel);
  if (start === null || end === null || start > end) {
    return [endLabel];
  }

  const labels: string[] = [];
  for (let index = start; index <= end; index += 1) {
    const year = Math.floor(index / 2);
    const semester = (index % 2) + 1;
    labels.push(`${year}-${semester}`);
  }
  return labels;
}

export function nextSemesterLabel(label: string): string {
  const match = label.match(/^(\d{4})-(1|2)$/);
  if (!match) {
    const now = new Date();
    const currentSemester = now.getMonth() <= 5 ? 1 : 2;
    return `${now.getFullYear()}-${currentSemester === 1 ? 2 : 1}`;
  }

  const year = Number(match[1]);
  const semester = Number(match[2]);
  return semester === 1 ? `${year}-2` : `${year + 1}-1`;
}

function roundToSingleDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function currentSemesterLabel(now: Date = new Date()): string {
  const semester = now.getMonth() <= 5 ? 1 : 2;
  return `${now.getFullYear()}-${semester}`;
}

function getSummaryMissingValue(parsedTranscript: ParsedTranscript, rowNeedle: string): number | null {
  const row = parsedTranscript.summary.find((item) => item.key.toLowerCase().includes(rowNeedle.toLowerCase()));
  const missing = row?.missing;
  if (typeof missing !== "number" || !Number.isFinite(missing)) {
    return null;
  }
  return Math.max(missing, 0);
}

function getChextMissingValue(parsedTranscript: ParsedTranscript): number {
  const row =
    parsedTranscript.extensionSummary.find((item) => item.key.toLowerCase().includes("geral")) ??
    parsedTranscript.extensionSummary.find((item) => item.key.toLowerCase().includes("chext"));
  const missing = row?.missing;
  if (typeof missing !== "number" || !Number.isFinite(missing)) {
    return 0;
  }
  return Math.max(missing, 0);
}

function normalizeRoadmapMissingCht(roadmap?: RoadmapResult): number {
  if (!roadmap) {
    return 0;
  }
  return roadmap.progress.reduce((sum, bucket) => sum + Math.max(bucket.missingCHT, 0), 0);
}

function buildApprovedChsBySemester(parsedTranscript: ParsedTranscript): Array<{ label: string; approvedChs: number }> {
  const semesterMap = new Map<string, number>();

  for (const attempt of parsedTranscript.attempts) {
    if (attempt.status !== "APPROVED") {
      continue;
    }
    if (isInternshipAttempt(attempt)) {
      continue;
    }
    if (!attempt.year || !attempt.semester) {
      continue;
    }
    if (attempt.semester !== 1 && attempt.semester !== 2) {
      continue;
    }

    const label = `${attempt.year}-${attempt.semester}`;
    const approvedChs = attempt.chs ?? estimateChsFromCht(attempt.cht);
    semesterMap.set(label, (semesterMap.get(label) ?? 0) + approvedChs);
  }

  return [...semesterMap.entries()]
    .sort((a, b) => {
      const [yearA, semA] = a[0].split("-").map(Number);
      const [yearB, semB] = b[0].split("-").map(Number);
      return yearA - yearB || semA - semB;
    })
    .map(([label, approvedChs]) => ({
      label,
      approvedChs: roundToSingleDecimal(approvedChs)
    }));
}

export function extractOfficialMissingFromTranscript(parsedTranscript: ParsedTranscript): OfficialTranscriptMissingWorkload | null {
  const mandatoryMissingCht = getSummaryMissingValue(parsedTranscript, "Obrigatórias");
  const optionalMissingCht = getSummaryMissingValue(parsedTranscript, "Optativas");
  const electiveMissingCht = getSummaryMissingValue(parsedTranscript, "Eletivas");

  if (mandatoryMissingCht === null || optionalMissingCht === null || electiveMissingCht === null) {
    return null;
  }

  const totalMissingCht = mandatoryMissingCht + optionalMissingCht + electiveMissingCht;
  return {
    mandatoryMissingCht,
    optionalMissingCht,
    electiveMissingCht,
    totalMissingCht,
    totalMissingChs: Math.ceil(totalMissingCht / 15),
    missingChext: getChextMissingValue(parsedTranscript)
  };
}

export function resolveMissingWorkload(params: {
  parsedTranscript?: ParsedTranscript;
  roadmap?: RoadmapResult;
}): {
  missingCht: number;
  missingChs: number;
  missingChext: number;
  source: GraduationForecastMissingSource;
  official: OfficialTranscriptMissingWorkload | null;
} {
  const official = params.parsedTranscript ? extractOfficialMissingFromTranscript(params.parsedTranscript) : null;
  if (official) {
    return {
      missingCht: official.totalMissingCht,
      missingChs: official.totalMissingChs,
      missingChext: official.missingChext,
      source: "official_summary",
      official
    };
  }

  const missingCht = normalizeRoadmapMissingCht(params.roadmap);
  return {
    missingCht,
    missingChs: Math.ceil(missingCht / 15),
    missingChext: params.parsedTranscript ? getChextMissingValue(params.parsedTranscript) : 0,
    source: "roadmap_fallback",
    official: null
  };
}

function projectSemesters(params: {
  averageChs: number;
  missingChs: number;
  startProjectedLabel: string;
  maxProjectedSemesters: number;
}): Array<{ label: string; projectedChs: number }> {
  const output: Array<{ label: string; projectedChs: number }> = [];
  const averageTenths = Math.max(1, Math.round(params.averageChs * 10));
  let remainingTenths = Math.max(0, Math.round(params.missingChs * 10));
  let cursor = params.startProjectedLabel;

  while (remainingTenths > 0 && output.length < params.maxProjectedSemesters) {
    const allocatedTenths = Math.min(averageTenths, remainingTenths);
    output.push({
      label: cursor,
      projectedChs: roundToSingleDecimal(allocatedTenths / 10)
    });
    remainingTenths -= allocatedTenths;
    cursor = nextSemesterLabel(cursor);
  }

  return output;
}

export function buildGraduationForecast(params: {
  parsedTranscript: ParsedTranscript;
  roadmap?: RoadmapResult;
  defaultAverageChs?: number;
  targetChsPerSemester?: number;
  includeCurrentSemesterIfInHistory?: boolean;
  maxProjectedSemesters?: number;
}): GraduationForecast | null {
  const historyBySemester = buildApprovedChsBySemester(params.parsedTranscript);
  if (historyBySemester.length === 0) {
    return null;
  }

  const firstSemesterWithChs = historyBySemester.find((item) => item.approvedChs > 0)?.label ?? historyBySemester[0].label;
  const lastHistoricalLabel = historyBySemester[historyBySemester.length - 1].label;
  const historicalLabels = buildSemesterRange(firstSemesterWithChs, lastHistoricalLabel);
  const historyMap = new Map(historyBySemester.map((item) => [item.label, item.approvedChs]));
  const historicalValues = historicalLabels.map((label) => roundToSingleDecimal(historyMap.get(label) ?? 0));
  const historicalTotal = historicalValues.reduce((sum, value) => sum + value, 0);
  const averageRaw = historicalValues.length > 0 ? historicalTotal / historicalValues.length : 0;
  const averageChs = averageRaw > 0 ? roundToSingleDecimal(averageRaw) : params.defaultAverageChs ?? DEFAULT_AVERAGE_CHS;
  const projectionChsRaw =
    typeof params.targetChsPerSemester === "number" && Number.isFinite(params.targetChsPerSemester) && params.targetChsPerSemester > 0
      ? params.targetChsPerSemester
      : averageChs;
  const projectionChs = roundToSingleDecimal(projectionChsRaw);

  const missing = resolveMissingWorkload({
    parsedTranscript: params.parsedTranscript,
    roadmap: params.roadmap
  });

  const nowLabel = currentSemesterLabel();
  const startProjectedLabel =
    (params.includeCurrentSemesterIfInHistory ?? true) && lastHistoricalLabel === nowLabel
      ? lastHistoricalLabel
      : nextSemesterLabel(lastHistoricalLabel);

  const projectedBySemester = projectSemesters({
    averageChs: projectionChs,
    missingChs: missing.missingChs,
    startProjectedLabel,
    maxProjectedSemesters: params.maxProjectedSemesters ?? DEFAULT_MAX_PROJECTED_SEMESTERS
  });

  const projectedLabels = projectedBySemester.map((item) => item.label);
  const projectedValues = projectedBySemester.map((item) => item.projectedChs);

  return {
    labels: [...historicalLabels, ...projectedLabels],
    historical: [...historicalValues, ...projectedLabels.map(() => null)],
    projected: [...historicalLabels.map(() => null), ...projectedValues],
    startLabel: firstSemesterWithChs,
    averageChs,
    projectionChs,
    missingCht: missing.missingCht,
    missingChs: missing.missingChs,
    missingChext: missing.missingChext,
    projectedSemesters: projectedBySemester.length,
    projectedEndSemester: projectedBySemester[projectedBySemester.length - 1]?.label ?? null,
    historyBySemester,
    projectedBySemester,
    missingSource: missing.source,
    methodologyNote: FORECAST_METHODOLOGY_NOTE,
    chextNote: FORECAST_CHEXT_NOTE
  };
}

export function buildGraduationForecastAudit(params: {
  parsedTranscript: ParsedTranscript;
  roadmap: RoadmapResult;
}): GraduationForecastAudit {
  const official = extractOfficialMissingFromTranscript(params.parsedTranscript);
  const internalMissingCht = normalizeRoadmapMissingCht(params.roadmap);
  const internalMissingChs = Math.ceil(internalMissingCht / 15);

  if (official) {
    return {
      officialMissingCht: official.totalMissingCht,
      officialMissingChs: official.totalMissingChs,
      internalMissingCht,
      internalMissingChs,
      differenceCht: official.totalMissingCht - internalMissingCht,
      differenceChs: official.totalMissingChs - internalMissingChs,
      missingChext: official.missingChext,
      missingSource: "official_summary",
      methodologyNote: FORECAST_METHODOLOGY_NOTE
    };
  }

  return {
    officialMissingCht: null,
    officialMissingChs: null,
    internalMissingCht,
    internalMissingChs,
    differenceCht: null,
    differenceChs: null,
    missingChext: getChextMissingValue(params.parsedTranscript),
    missingSource: "roadmap_fallback",
    methodologyNote: FORECAST_METHODOLOGY_NOTE
  };
}
