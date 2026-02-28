"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bar, Line } from "react-chartjs-2";
import {
  PointElement,
  LineElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartData,
  type ChartOptions
} from "chart.js";

import type {
  AssistantChatResponse,
  AssistantPlanProposal,
  AssistantPlanPatch,
  AssistantQuestion,
  DisciplineLookupResponse,
  GraduationForecastAudit,
  GradeOptionsResponse,
  ManualCorrelationInput,
  MatrixCode,
  PendingDiscipline,
  ParsedTranscript,
  RoadmapResult
} from "@/types/academic";
import { DisciplineDragCard } from "@/components/roadmap/discipline-drag-card";
import { AcademicCalendar } from "@/components/roadmap/dashboard/academic-calendar";
import { CourseAtmosphere } from "@/components/roadmap/dashboard/course-atmosphere";
import { FocusModeToggle } from "@/components/roadmap/dashboard/focus-mode-toggle";
import { NextClassWidget } from "@/components/roadmap/dashboard/next-class-widget";
import { QuickStats } from "@/components/roadmap/dashboard/quick-stats";
import { SmartSuggestions } from "@/components/roadmap/dashboard/smart-suggestions";
import { SubjectRoadmap } from "@/components/roadmap/dashboard/subject-roadmap";
import { AchievementToast } from "@/components/roadmap/feedback/achievement-toast";
import { MetricCard } from "@/components/roadmap/metric-card";
import { PeriodRoadmapMegaChart } from "@/components/roadmap/period-roadmap-mega-chart";
import { PeriodDropLane } from "@/components/roadmap/period-drop-lane";
import { SectionTitle } from "@/components/roadmap/section-title";
import { DashboardSection } from "@/components/roadmap/sections/dashboard-section";
import { GraphSection } from "@/components/roadmap/sections/graph-section";
import { ManualCorrelationSection } from "@/components/roadmap/sections/manual-correlation-section";
import { PlannerSection } from "@/components/roadmap/sections/planner-section";
import { ReviewSection } from "@/components/roadmap/sections/review-section";
import { UnusedSection } from "@/components/roadmap/sections/unused-section";
import { UploadSection } from "@/components/roadmap/sections/upload-section";
import { useRoadmapWorkspaceState } from "@/components/roadmap/state/use-roadmap-workspace-state";
import { StatusPill } from "@/components/roadmap/status-pill";
import { SurfaceCard } from "@/components/roadmap/surface-card";
import { WeeklyAgendaBoard } from "@/components/roadmap/weekly-agenda-board";
import {
  ROADMAP_ASSISTANT_TOGGLE_EVENT,
  ROADMAP_EXPORT_JSON_EVENT,
  ROADMAP_EXPORT_PDF_EVENT,
  ROADMAP_EXPORT_STATE_UPDATED_EVENT,
  ROADMAP_WORKSPACE_EXPORT_STATE_KEY,
  ROADMAP_WORKSPACE_STORAGE_KEY
} from "@/components/roadmap/layout/workspace-events";
import { buildDashboardVisualModel } from "@/lib/domain/dashboard-visual-mappers";
import {
  buildGraduationForecast,
  buildGraduationForecastAudit,
  estimateChsFromCht
} from "@/lib/domain/graduation-forecast";
import {
  getMatrixMetadata,
  getOptionalPoolModules,
  inferCourseAbbreviation,
  inferMatrixCodeFromCourseCode,
  isSupportedMatrixCode,
  MATRIX_CODE_VALUES,
  resolveCampusCodeForMatrix,
  resolveCourseCodeForMatrix
} from "@/lib/domain/matrix-metadata";
import { disciplineNamesLikelyMatch, normalizeDisciplineNameForComparison } from "@/lib/utils/academic";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

const chartOptions: ChartOptions<"bar"> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom"
    }
  },
  scales: {
    y: {
      beginAtZero: true
    }
  }
};

const lineChartOptions: ChartOptions<"line"> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom"
    }
  },
  scales: {
    y: {
      beginAtZero: true
    }
  }
};

const sectorDefinitions = [
  { category: "MANDATORY", label: "Obrigatórias" },
  { category: "OPTIONAL", label: "Optativas" },
  { category: "ELECTIVE", label: "Eletivas" },
  { category: "COMPLEMENTARY", label: "Atividades Complementares" },
  { category: "INTERNSHIP", label: "Estágio" },
  { category: "TCC", label: "TCC" }
] as const;

const periodCategoryDefinitions = [
  { key: "MANDATORY", label: "Obrigatórias", color: "#6a7cff" },
  { key: "OPTIONAL", label: "Optativas", color: "#22d3ee" },
  { key: "TRACK", label: "Trilhas", color: "#4ad89d" },
  { key: "ELECTIVE", label: "Eletivas", color: "#f59e0b" },
  { key: "COMPLEMENTARY", label: "Complementares", color: "#a78bfa" },
  { key: "INTERNSHIP", label: "Estágio", color: "#f472b6" },
  { key: "TCC", label: "TCC", color: "#facc15" }
] as const;

const SUPPORTED_MATRICES_LABEL = MATRIX_CODE_VALUES.join(", ");

function statusVariant(status: string): "done" | "available" | "blocked" | "failed" | "neutral" {
  if (status === "DONE" || status === "APPROVED") return "done";
  if (status === "AVAILABLE") return "available";
  if (status === "BLOCKED") return "blocked";
  if (status === "FAILED" || status === "CANCELED") return "failed";
  return "neutral";
}

function nodeStatusLabel(status: string): string {
  if (status === "DONE") {
    return "Concluída";
  }
  if (status === "AVAILABLE") {
    return "Faltante (liberada)";
  }
  if (status === "BLOCKED") {
    return "Faltante (bloqueada)";
  }
  return status;
}

function prettyHorario(code: string): { day: string; shift: string } {
  const match = code.toUpperCase().match(/^([2-7])([MTN])\d+$/);
  if (!match) {
    return { day: "Outro", shift: "Turno" };
  }

  const days: Record<string, string> = {
    "2": "Segunda",
    "3": "Terça",
    "4": "Quarta",
    "5": "Quinta",
    "6": "Sexta",
    "7": "Sábado"
  };
  const shifts: Record<string, string> = { M: "Manhã", T: "Tarde", N: "Noite" };
  return {
    day: days[match[1]] ?? "Outro",
    shift: shifts[match[2]] ?? "Turno"
  };
}

function isElectiveLikeAttempt(attempt: ParsedTranscript["attempts"][number]): boolean {
  if (attempt.sourceSection === "elective") {
    return true;
  }

  const code = attempt.code.trim().toUpperCase();
  const name = (attempt.name ?? "").toLowerCase();
  return code.startsWith("ELE") || code.startsWith("ELV") || name.includes("eletiv");
}

function formatYearSemester(year?: number | null, semester?: number | null): string {
  const normalizedYear = typeof year === "number" && Number.isFinite(year) ? year : null;
  const normalizedSemester = typeof semester === "number" && Number.isFinite(semester) ? semester : null;

  if (normalizedYear && normalizedSemester) {
    return `${normalizedYear}-${normalizedSemester}`;
  }
  if (normalizedYear) {
    return String(normalizedYear);
  }
  if (normalizedSemester) {
    return `Sem ${normalizedSemester}`;
  }
  return "-";
}

function extractRawElectiveSnippets(rawText: string, maxItems = 16): string[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const keywords = /(eletiv|optativ|resumo eletiva|carga horaria total|carga horária total)/i;
  const snippets: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    if (!keywords.test(lines[index])) {
      continue;
    }

    const start = Math.max(0, index - 1);
    const end = Math.min(lines.length - 1, index + 1);
    const snippet = lines.slice(start, end + 1).join(" | ");
    if (seen.has(snippet)) {
      continue;
    }
    seen.add(snippet);
    snippets.push(snippet);
    if (snippets.length >= maxItems) {
      break;
    }
  }

  return snippets;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as { error?: string; details?: string };
      if (payload.error && payload.details) {
        return `${payload.error} (${payload.details})`;
      }
      if (payload.error) {
        return payload.error;
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  try {
    const text = (await response.text()).trim();
    if (!text) {
      return fallback;
    }
    return `${fallback} (resposta não-JSON do servidor)`;
  } catch {
    return fallback;
  }
}

function normalizeManualTargetCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function extractTargetCodeFromLookupValue(value: string): string {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) {
    return "";
  }

  const prefixMatch = trimmed.match(/^([A-Z0-9]+)\s*[-|]/);
  if (prefixMatch?.[1]) {
    return normalizeManualTargetCode(prefixMatch[1]);
  }

  const embeddedCodeMatch = trimmed.match(/[A-Z]{2,}\d{2,}[A-Z0-9]*/);
  if (embeddedCodeMatch?.[0]) {
    return normalizeManualTargetCode(embeddedCodeMatch[0]);
  }

  if (/^[A-Z]{2,}\d{2,}[A-Z0-9]*$/.test(trimmed)) {
    return normalizeManualTargetCode(trimmed);
  }

  return "";
}

function buildManualMappingsFromCorrelations(manualCorrelations: Record<string, string>): ManualCorrelationInput[] {
  return Object.entries(manualCorrelations).flatMap(([sourceCode, targetCode]) => {
    const normalizedTargetCode = extractTargetCodeFromLookupValue(targetCode);
    if (!normalizedTargetCode) {
      return [];
    }
    return [{ sourceCode, targetCode: normalizedTargetCode }];
  });
}

function buildCombinedManualMappings(
  manualCorrelations: Record<string, string>,
  convalidationMappings: Record<string, ManualCorrelationInput>,
  reviewCategoryMappings: ManualCorrelationInput[] = []
): ManualCorrelationInput[] {
  const merged = new Map<string, ManualCorrelationInput>();

  for (const mapping of buildManualMappingsFromCorrelations(manualCorrelations)) {
    const sourceCode = normalizeManualTargetCode(mapping.sourceCode ?? "");
    const key = sourceCode || normalizeDisciplineNameForComparison(mapping.sourceName ?? "");
    if (!key) {
      continue;
    }
    merged.set(key, mapping);
  }

  for (const mapping of reviewCategoryMappings) {
    const sourceCode = normalizeManualTargetCode(mapping.sourceCode ?? "");
    const key = sourceCode || normalizeDisciplineNameForComparison(mapping.sourceName ?? "");
    if (!key) {
      continue;
    }
    merged.set(key, mapping);
  }

  for (const mapping of Object.values(convalidationMappings)) {
    const sourceCode = normalizeManualTargetCode(mapping.sourceCode ?? "");
    const key = sourceCode || normalizeDisciplineNameForComparison(mapping.sourceName ?? "");
    if (!key) {
      continue;
    }
    merged.set(key, mapping);
  }

  return [...merged.values()];
}

function buildParseValidationError(parsed: ParsedTranscript): string | null {
  if (parsed.attempts.length > 0) {
    return null;
  }

  const normalizedRawText = (parsed.rawText ?? "").toLowerCase();
  const looksLikeMatrixDocument =
    normalizedRawText.includes("consulta curso e matriz curricular") || normalizedRawText.includes("matriz curricular - versão");

  if (looksLikeMatrixDocument) {
    return "O PDF enviado parece ser a matriz curricular do curso, não o histórico escolar do aluno. Envie o histórico completo (com disciplinas cursadas, status e notas).";
  }

  if (parsed.warnings.length > 0) {
    return `Não foi possível extrair disciplinas do histórico. ${parsed.warnings.join(" ")}`;
  }

  return "Não foi possível extrair disciplinas do histórico. Verifique se o PDF é o histórico completo e tente novamente.";
}

const CORRELATION_CATEGORY_LABEL: Record<PendingDiscipline["category"], string> = {
  MANDATORY: "Obrigatórias",
  OPTIONAL: "Optativas",
  TRACK: "Trilha",
  ELECTIVE: "Eletivas",
  COMPLEMENTARY: "Complementares",
  INTERNSHIP: "Estágio",
  TCC: "TCC",
  UNKNOWN: "Outras"
};

type CorrelationCategory = PendingDiscipline["category"];
type CalculationCategory = Exclude<CorrelationCategory, "UNKNOWN"> | "EXTENSION";

const CALCULATION_CATEGORY_ORDER: CalculationCategory[] = [
  "MANDATORY",
  "OPTIONAL",
  "TRACK",
  "ELECTIVE",
  "COMPLEMENTARY",
  "INTERNSHIP",
  "TCC",
  "EXTENSION"
];

const DEFAULT_CALCULATION_CATEGORIES = [...CALCULATION_CATEGORY_ORDER];

function sanitizeCalculationCategories(value: unknown, allowedCategories: CalculationCategory[] = DEFAULT_CALCULATION_CATEGORIES): CalculationCategory[] {
  if (!Array.isArray(value)) {
    return [...allowedCategories];
  }

  const allowed = new Set<CalculationCategory>(allowedCategories);
  const categories = value
    .map((item) => String(item).toUpperCase() as CalculationCategory)
    .filter((item): item is CalculationCategory => allowed.has(item));

  return categories.length > 0 ? [...new Set(categories)] : [...allowedCategories];
}

interface CorrelationLookupOption {
  key: string;
  code: string;
  name: string;
  category: CorrelationCategory;
  categoryLabel: string;
  matrixCode: MatrixCode;
  courseCode: string;
  courseAbbr: string;
  catalogOnly: boolean;
  lookupValue: string;
  searchText: string;
}

function ensureRoadmapShape(roadmap: RoadmapResult): RoadmapResult {
  return {
    ...roadmap,
    unmatchedApprovedAttempts: roadmap.unmatchedApprovedAttempts ?? [],
    electiveOptions: roadmap.electiveOptions ?? []
  };
}

function looksLikeLegacyUnusedSnapshot(roadmap: RoadmapResult): boolean {
  const rows = roadmap.unusedDisciplines.filter((item) => item.code.toUpperCase() !== "ELETIVAS");
  if (rows.length === 0) {
    return false;
  }

  const suspicious = rows.filter((item) => {
    const trimmedName = (item.name ?? "").trim();
    const looksNumericName = /^\d+$/.test(trimmedName);
    const hasNumericRelated = (item.relatedSubjects ?? []).some((subject) => /-\s*\d+\s*$/i.test(subject.trim()));
    return item.cht === 0 || looksNumericName || hasNumericRelated;
  });

  return suspicious.length >= 3;
}

function buildCorrelationLookupValue(option: {
  code: string;
  name: string;
  courseAbbr: string;
  matrixCode: MatrixCode;
  categoryLabel: string;
}): string {
  return `${option.code} - ${option.name} [${option.courseAbbr} | Matriz ${option.matrixCode} | ${option.categoryLabel}]`;
}

const SYNTHETIC_ELECTIVE_PENDING_PATTERN = /^ELVP\d{3}C\d{3}$/i;
const UNKNOWN_TRACK_LABEL = "Trilha não identificada";

function isSyntheticElectivePendingCode(code: string): boolean {
  return SYNTHETIC_ELECTIVE_PENDING_PATTERN.test(code.trim().toUpperCase());
}

function normalizeTrackLabel(value?: string | null): string {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized || UNKNOWN_TRACK_LABEL;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function progressKeyToCalculationCategory(
  key: RoadmapResult["progress"][number]["key"]
): CalculationCategory | null {
  if (key === "mandatory") return "MANDATORY";
  if (key === "optional") return "OPTIONAL";
  if (key === "elective") return "ELECTIVE";
  if (key === "complementary") return "COMPLEMENTARY";
  if (key === "internship") return "INTERNSHIP";
  if (key === "tcc") return "TCC";
  if (key === "extension") return "EXTENSION";
  return null;
}

function calculationCategoryLabel(category: CalculationCategory): string {
  if (category === "EXTENSION") {
    return "Extensão";
  }
  return CORRELATION_CATEGORY_LABEL[category];
}

function isCorrelationCalculationCategory(category: CalculationCategory): category is Exclude<CorrelationCategory, "UNKNOWN"> {
  return category !== "EXTENSION";
}

function deriveAvailableCategoriesFromRoadmap(roadmap: RoadmapResult | null): CalculationCategory[] {
  if (!roadmap) {
    return [...DEFAULT_CALCULATION_CATEGORIES];
  }

  const available = new Set<CalculationCategory>();

  for (const bucket of roadmap.progress) {
    const category = progressKeyToCalculationCategory(bucket.key);
    if (category) {
      available.add(category);
    }
  }

  for (const node of roadmap.prereqGraph.nodes) {
    if (node.status === "OUTSIDE_SCOPE" || node.category === "UNKNOWN") {
      continue;
    }
    available.add(node.category as Exclude<CorrelationCategory, "UNKNOWN">);
  }

  if (available.size === 0) {
    return [...DEFAULT_CALCULATION_CATEGORIES];
  }

  return CALCULATION_CATEGORY_ORDER.filter((category) => available.has(category));
}

function deriveMatrixPeriodCount(roadmap: RoadmapResult | null): number {
  if (!roadmap) {
    return 8;
  }

  const maxPeriodFromGraph = roadmap.prereqGraph.nodes.reduce((max, node) => {
    const period = node.recommendedPeriod ?? 0;
    if (!Number.isFinite(period) || period < 0) {
      return max;
    }
    return Math.max(max, Math.floor(period));
  }, 0);

  if (maxPeriodFromGraph > 0) {
    return maxPeriodFromGraph;
  }

  return roadmap.matrixCode === "844" || roadmap.matrixCode === "962" ? 10 : 8;
}

function buildTrackLabelByCode(roadmap: RoadmapResult): Map<string, string> {
  const map = new Map<string, string>();

  for (const node of roadmap.prereqGraph.nodes) {
    if (node.category !== "TRACK") {
      continue;
    }
    const code = node.code.trim().toUpperCase();
    if (!code) {
      continue;
    }
    map.set(code, normalizeTrackLabel(node.track ?? node.subcategory));
  }

  return map;
}

function resolvePendingTrackLabel(item: PendingDiscipline, trackLabelByCode: Map<string, string>): string {
  return trackLabelByCode.get(item.code.trim().toUpperCase()) ?? normalizeTrackLabel(item.subcategory);
}

interface PlannerTrackOption {
  key: string;
  label: string;
  totalNodes: number;
  doneNodes: number;
  initiated: boolean;
  pendingTotal: number;
  pendingAvailable: number;
  pendingBlocked: number;
  pendingCht: number;
}

function getPlannerTrackOptions(roadmap: RoadmapResult): PlannerTrackOption[] {
  const trackLabelByCode = buildTrackLabelByCode(roadmap);
  const options = new Map<string, PlannerTrackOption>();

  const ensureOption = (key: string): PlannerTrackOption => {
    const existing = options.get(key);
    if (existing) {
      return existing;
    }

    const created: PlannerTrackOption = {
      key,
      label: key,
      totalNodes: 0,
      doneNodes: 0,
      initiated: false,
      pendingTotal: 0,
      pendingAvailable: 0,
      pendingBlocked: 0,
      pendingCht: 0
    };
    options.set(key, created);
    return created;
  };

  for (const node of roadmap.prereqGraph.nodes) {
    if (!node.track) {
      continue;
    }

    const key = normalizeTrackLabel(node.track);
    const current = ensureOption(key);
    current.totalNodes += 1;
    if (node.status === "DONE") {
      current.doneNodes += 1;
      current.initiated = true;
    }
  }

  for (const discipline of roadmap.pending) {
    if (discipline.category !== "TRACK") {
      continue;
    }

    const key = resolvePendingTrackLabel(discipline, trackLabelByCode);
    const current = ensureOption(key);

    current.pendingTotal += 1;
    current.pendingCht += Math.max(discipline.cht, 0);
    if (discipline.status === "AVAILABLE") {
      current.pendingAvailable += 1;
    } else {
      current.pendingBlocked += 1;
    }
  }

  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function normalizePlannerPendingWithoutChext(item: PendingDiscipline): PendingDiscipline | null {
  const chext = Math.max(item.chext ?? 0, 0);
  const effectiveCht = Math.max(item.cht - chext, 0);
  if (effectiveCht <= 0) {
    return null;
  }

  return {
    ...item,
    cht: effectiveCht,
    chext: 0
  };
}

function getPlannerPendingList(
  roadmap: RoadmapResult,
  gradeOptions?: GradeOptionsResponse | null,
  selectedTrackKeys: string[] = [],
  includedCategories?: Set<CalculationCategory>
): PendingDiscipline[] {
  const selectedTracks = new Set(selectedTrackKeys.map((key) => normalizeTrackLabel(key)));
  const trackLabelByCode = buildTrackLabelByCode(roadmap);
  const pendingByScope = roadmap.pending.filter((item) => {
    if (includedCategories && (item.category === "UNKNOWN" || !includedCategories.has(item.category as CalculationCategory))) {
      return false;
    }
    if (item.category !== "TRACK" || selectedTracks.size === 0) {
      return true;
    }
    const trackKey = resolvePendingTrackLabel(item, trackLabelByCode);
    return selectedTracks.has(trackKey);
  });

  const syntheticPendings = pendingByScope.filter((item) => isSyntheticElectivePendingCode(item.code));
  if (syntheticPendings.length === 0) {
    return pendingByScope
      .map((item) => normalizePlannerPendingWithoutChext(item))
      .filter((item): item is PendingDiscipline => Boolean(item));
  }

  const nonSynthetic = pendingByScope.filter((item) => !isSyntheticElectivePendingCode(item.code));
  const requiredElectiveCht = syntheticPendings.reduce((sum, item) => sum + item.cht, 0);
  const electiveCandidatesFromCatalog = (roadmap.electiveOptions ?? [])
    .filter((item) => item.status !== "DONE")
    .sort((a, b) => (a.recommendedPeriod ?? 99) - (b.recommendedPeriod ?? 99) || a.code.localeCompare(b.code));

  const electiveCandidatesFromOffer = (gradeOptions?.availableByDiscipline ?? [])
    .filter((item) => item.code.toUpperCase().startsWith("ELE"))
    .map((item) => ({
      code: item.code,
      name: item.name,
      cht: Math.max((item.credits ?? 1) * 15, 15),
      recommendedPeriod: undefined
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const electiveCandidates =
    electiveCandidatesFromCatalog.length > 0
      ? electiveCandidatesFromCatalog
      : electiveCandidatesFromOffer;

  if (electiveCandidates.length === 0) {
    return pendingByScope;
  }

  const chosenElectives: PendingDiscipline[] = [];
  let accumulated = 0;

  for (const option of electiveCandidates) {
    chosenElectives.push({
      code: option.code,
      name: option.name,
      category: "ELECTIVE",
      subcategory: "Eletivas da Matriz",
      recommendedPeriod: option.recommendedPeriod,
      prerequisites: [],
      blockedBy: [],
      status: "AVAILABLE",
      cht: option.cht,
      chext: 0
    });
    accumulated += option.cht;
    if (accumulated >= requiredElectiveCht) {
      break;
    }
  }

  return [...nonSynthetic, ...chosenElectives]
    .map((item) => normalizePlannerPendingWithoutChext(item))
    .filter((item): item is PendingDiscipline => Boolean(item));
}

function buildManualMappingsFromReviewCategoryOverrides(
  parsedTranscript: ParsedTranscript | null,
  reviewCategoryBySourceCode: Record<string, CorrelationCategory>
): ManualCorrelationInput[] {
  if (!parsedTranscript) {
    return [];
  }

  const approvedAttempts = parsedTranscript.attempts
    .filter((attempt) => attempt.status === "APPROVED")
    .sort((a, b) => {
      const yearDiff = (b.year ?? 0) - (a.year ?? 0);
      if (yearDiff !== 0) {
        return yearDiff;
      }
      return (b.semester ?? 0) - (a.semester ?? 0);
    });

  const seenSourceCodes = new Set<string>();
  const mappings: ManualCorrelationInput[] = [];

  for (const attempt of approvedAttempts) {
    const sourceCode = normalizeManualTargetCode(attempt.code);
    if (!sourceCode || seenSourceCodes.has(sourceCode)) {
      continue;
    }

    const targetCategory = reviewCategoryBySourceCode[sourceCode];
    if (!targetCategory) {
      continue;
    }

    const creditedCHT = Math.max(Math.round(Number(attempt.cht ?? 0)), 0);
    if (creditedCHT <= 0) {
      continue;
    }

    mappings.push({
      sourceCode,
      sourceName: attempt.name,
      targetCategory,
      creditedCHT,
      manualOnly: true
    });
    seenSourceCodes.add(sourceCode);
  }

  return mappings;
}

export type RoadmapSectionKey = "upload" | "review" | "dashboard" | "graph" | "planner" | "unused";

interface RoadmapWorkspaceProps {
  currentSection: RoadmapSectionKey;
}

interface AssistantMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
  action?: AssistantChatResponse["action"];
  proposals?: AssistantPlanProposal[];
  question?: AssistantQuestion;
  planPatch?: AssistantPlanPatch;
  providerUsed?: AssistantChatResponse["providerUsed"];
  diagnostics?: string[];
  createdAt: string;
}

type PrereqNode = RoadmapResult["prereqGraph"]["nodes"][number];

export function RoadmapWorkspace({ currentSection }: RoadmapWorkspaceProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedTranscript, setParsedTranscript] = useState<ParsedTranscript | null>(null);
  const [roadmap, setRoadmap] = useState<RoadmapResult | null>(null);
  const [gradeOptions, setGradeOptions] = useState<GradeOptionsResponse | null>(null);
  const [activeMatrix, setActiveMatrix] = useState<MatrixCode | "">("");
  const [maxChsPerPeriod, setMaxChsPerPeriod] = useState<number>(18);
  const [selectedPlannerTracks, setSelectedPlannerTracks] = useState<string[]>([]);
  const [enabledCalculationCategories, setEnabledCalculationCategories] = useState<CalculationCategory[]>(DEFAULT_CALCULATION_CATEGORIES);
  const [selectedPlanPeriod, setSelectedPlanPeriod] = useState<number>(1);
  const [manualPlan, setManualPlan] = useState<Record<number, string[]>>({});
  const [manualCorrelations, setManualCorrelations] = useState<Record<string, string>>({});
  const [manualConvalidationMappings, setManualConvalidationMappings] = useState<Record<string, ManualCorrelationInput>>({});
  const [reviewCategoryBySourceCode, setReviewCategoryBySourceCode] = useState<Record<string, CorrelationCategory>>({});
  const [unusedInlineTargetBySource, setUnusedInlineTargetBySource] = useState<Record<string, string>>({});
  const [unusedInlineCategoryBySource, setUnusedInlineCategoryBySource] = useState<Record<string, CorrelationCategory>>({});
  const [unusedInlineChtBySource, setUnusedInlineChtBySource] = useState<Record<string, string>>({});
  const [unusedInlineManualOnlyBySource, setUnusedInlineManualOnlyBySource] = useState<Record<string, boolean>>({});
  const [unusedInlineManualNameBySource, setUnusedInlineManualNameBySource] = useState<Record<string, string>>({});
  const [unusedInlineManualCodeBySource, setUnusedInlineManualCodeBySource] = useState<Record<string, string>>({});
  const [globalDisciplineLookupOptions, setGlobalDisciplineLookupOptions] = useState<CorrelationLookupOption[]>([]);
  const [unusedConvalidationNotice, setUnusedConvalidationNotice] = useState<string | null>(null);
  const [unusedConvalidationError, setUnusedConvalidationError] = useState<string | null>(null);
  const [snapshotRestoredFromLocalCache, setSnapshotRestoredFromLocalCache] = useState(false);
  const [showLegacySnapshotWarning, setShowLegacySnapshotWarning] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantWidgetOpen, setAssistantWidgetOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      text:
        "Sou seu assistente de planejamento UTFPR. Uso seu roadmap + histórico + GradeNaHora (semestre mais recente disponível) e respeito as trilhas selecionadas no Planejamento para sugerir grade com restrições reais.",
      createdAt: new Date().toISOString()
    }
  ]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { uiState, toggleFocusMode, setFocusedSubject, openAchievementToast, closeAchievementToast } =
    useRoadmapWorkspaceState();

  const effectiveMatrixCode = useMemo<MatrixCode>(() => {
    if (isSupportedMatrixCode(activeMatrix)) {
      return activeMatrix;
    }
    if (isSupportedMatrixCode(roadmap?.matrixCode)) {
      return roadmap.matrixCode;
    }

    const inferredByTranscriptCourse = inferMatrixCodeFromCourseCode(parsedTranscript?.student.courseCode);
    if (inferredByTranscriptCourse) {
      return inferredByTranscriptCourse;
    }

    const inferredByRoadmapCourse = inferMatrixCodeFromCourseCode(roadmap?.student.courseCode);
    return inferredByRoadmapCourse ?? "981";
  }, [activeMatrix, parsedTranscript?.student.courseCode, roadmap?.matrixCode, roadmap?.student.courseCode]);

  const optionalModuleDefinitions = useMemo(() => getOptionalPoolModules(effectiveMatrixCode), [effectiveMatrixCode]);

  const optionalNonTrackRequiredCHT = useMemo(
    () =>
      optionalModuleDefinitions
        .filter((moduleDefinition) => moduleDefinition.key !== "tracks")
        .reduce((sum, moduleDefinition) => sum + moduleDefinition.requiredCHT, 0),
    [optionalModuleDefinitions]
  );

  const trackRequiredCHT = useMemo(
    () => optionalModuleDefinitions.find((moduleDefinition) => moduleDefinition.key === "tracks")?.requiredCHT ?? 0,
    [optionalModuleDefinitions]
  );

  const optionalPoolTotalRequiredCHT = useMemo(
    () => optionalModuleDefinitions.reduce((sum, moduleDefinition) => sum + moduleDefinition.requiredCHT, 0),
    [optionalModuleDefinitions]
  );

  const optionalPoolBreakdownLabel = useMemo(
    () => optionalModuleDefinitions.map((moduleDefinition) => moduleDefinition.requiredCHT).join(" + "),
    [optionalModuleDefinitions]
  );

  const optionalNonTrackLabel = useMemo(
    () =>
      optionalModuleDefinitions
        .filter((moduleDefinition) => moduleDefinition.key !== "tracks")
        .map((moduleDefinition) => moduleDefinition.label)
        .join(" + "),
    [optionalModuleDefinitions]
  );

  const trackModuleLabel = useMemo(
    () => optionalModuleDefinitions.find((moduleDefinition) => moduleDefinition.key === "tracks")?.label ?? "Trilhas",
    [optionalModuleDefinitions]
  );

  const availableCalculationCategories = useMemo(
    () => deriveAvailableCategoriesFromRoadmap(roadmap),
    [roadmap]
  );
  const matrixPeriodCount = useMemo(
    () => deriveMatrixPeriodCount(roadmap),
    [roadmap]
  );

  const calculationFilterOptions = useMemo(
    () =>
      availableCalculationCategories.map((category) => ({
        category,
        label: calculationCategoryLabel(category)
      })),
    [availableCalculationCategories]
  );

  const correlationCategoryOptions = useMemo<CorrelationCategory[]>(
    () => availableCalculationCategories.filter((category) => isCorrelationCalculationCategory(category)) as CorrelationCategory[],
    [availableCalculationCategories]
  );

  const fallbackCorrelationCategory = useMemo<CorrelationCategory>(
    () => correlationCategoryOptions[0] ?? "MANDATORY",
    [correlationCategoryOptions]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ROADMAP_WORKSPACE_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const saved = JSON.parse(raw) as {
        parsedTranscript?: ParsedTranscript | null;
        roadmap?: RoadmapResult | null;
        gradeOptions?: GradeOptionsResponse | null;
        activeMatrix?: MatrixCode | "";
        maxChsPerPeriod?: number;
        selectedPlannerTracks?: string[];
        enabledCalculationCategories?: CalculationCategory[];
        selectedPlanPeriod?: number;
        manualPlan?: Record<number, string[]>;
        manualCorrelations?: Record<string, string>;
        manualConvalidationMappings?: Record<string, ManualCorrelationInput>;
        reviewCategoryBySourceCode?: Record<string, CorrelationCategory>;
        unusedInlineCategoryBySource?: Record<string, CorrelationCategory>;
        unusedInlineChtBySource?: Record<string, string>;
        unusedInlineManualOnlyBySource?: Record<string, boolean>;
        unusedInlineManualNameBySource?: Record<string, string>;
        unusedInlineManualCodeBySource?: Record<string, string>;
        assistantMessages?: AssistantMessage[];
      };

      let restoredSnapshot = false;
      let restoredRoadmap: RoadmapResult | null = null;

      if (saved.parsedTranscript) {
        setParsedTranscript(saved.parsedTranscript);
        restoredSnapshot = true;
      }
      if (saved.roadmap) {
        restoredRoadmap = ensureRoadmapShape(saved.roadmap);
        setRoadmap(restoredRoadmap);
        restoredSnapshot = true;
      }
      if (saved.gradeOptions) setGradeOptions(saved.gradeOptions);
      if (saved.activeMatrix === "" || isSupportedMatrixCode(saved.activeMatrix)) {
        setActiveMatrix(saved.activeMatrix);
      }
      if (typeof saved.maxChsPerPeriod === "number" && Number.isFinite(saved.maxChsPerPeriod)) {
        setMaxChsPerPeriod(saved.maxChsPerPeriod);
      }
      if (Array.isArray(saved.selectedPlannerTracks)) {
        setSelectedPlannerTracks(
          saved.selectedPlannerTracks
            .map((track) => normalizeTrackLabel(track))
            .filter((track, index, array) => array.indexOf(track) === index)
        );
      }
      if (saved.enabledCalculationCategories) {
        setEnabledCalculationCategories(sanitizeCalculationCategories(saved.enabledCalculationCategories));
      }
      if (typeof saved.selectedPlanPeriod === "number" && Number.isFinite(saved.selectedPlanPeriod)) {
        setSelectedPlanPeriod(saved.selectedPlanPeriod);
      }
      if (saved.manualPlan) setManualPlan(saved.manualPlan);
      if (saved.manualCorrelations) setManualCorrelations(saved.manualCorrelations);
      if (saved.manualConvalidationMappings) setManualConvalidationMappings(saved.manualConvalidationMappings);
      if (saved.reviewCategoryBySourceCode) setReviewCategoryBySourceCode(saved.reviewCategoryBySourceCode);
      if (saved.unusedInlineCategoryBySource) setUnusedInlineCategoryBySource(saved.unusedInlineCategoryBySource);
      if (saved.unusedInlineChtBySource) setUnusedInlineChtBySource(saved.unusedInlineChtBySource);
      if (saved.unusedInlineManualOnlyBySource) setUnusedInlineManualOnlyBySource(saved.unusedInlineManualOnlyBySource);
      if (saved.unusedInlineManualNameBySource) setUnusedInlineManualNameBySource(saved.unusedInlineManualNameBySource);
      if (saved.unusedInlineManualCodeBySource) setUnusedInlineManualCodeBySource(saved.unusedInlineManualCodeBySource);
      if (saved.assistantMessages && saved.assistantMessages.length > 0) {
        setAssistantMessages(saved.assistantMessages);
      }
      setSnapshotRestoredFromLocalCache(restoredSnapshot);
      setShowLegacySnapshotWarning(Boolean(restoredRoadmap && looksLikeLegacyUnusedSnapshot(restoredRoadmap)));
    } catch {
      // ignore corrupted local storage payload
    }
  }, []);

  useEffect(() => {
    const payload = {
      parsedTranscript,
      roadmap,
      gradeOptions,
      activeMatrix,
      maxChsPerPeriod,
      selectedPlannerTracks,
      enabledCalculationCategories,
      selectedPlanPeriod,
      manualPlan,
      manualCorrelations,
      manualConvalidationMappings,
      reviewCategoryBySourceCode,
      unusedInlineCategoryBySource,
      unusedInlineChtBySource,
      unusedInlineManualOnlyBySource,
      unusedInlineManualNameBySource,
      unusedInlineManualCodeBySource,
      assistantMessages
    };

    try {
      localStorage.setItem(ROADMAP_WORKSPACE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage quota errors
    }
  }, [
    parsedTranscript,
    roadmap,
    gradeOptions,
    activeMatrix,
    maxChsPerPeriod,
    selectedPlannerTracks,
    enabledCalculationCategories,
    selectedPlanPeriod,
    manualPlan,
    manualCorrelations,
    manualConvalidationMappings,
    reviewCategoryBySourceCode,
    unusedInlineCategoryBySource,
    unusedInlineChtBySource,
    unusedInlineManualOnlyBySource,
    unusedInlineManualNameBySource,
    unusedInlineManualCodeBySource,
    assistantMessages
  ]);

  useEffect(() => {
    setEnabledCalculationCategories((current) =>
      sanitizeCalculationCategories(current, availableCalculationCategories)
    );
  }, [availableCalculationCategories]);

  useEffect(() => {
    setReviewCategoryBySourceCode((current) => {
      const nextEntries = Object.entries(current).filter(([, category]) => correlationCategoryOptions.includes(category));
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [correlationCategoryOptions]);

  useEffect(() => {
    let canceled = false;

    const loadDisciplineLookup = async (): Promise<void> => {
      try {
        const response = await fetch("/api/roadmap/lookup-disciplines");
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Falha ao carregar lookup global de disciplinas."));
        }
        const payload = (await response.json()) as DisciplineLookupResponse;

        if (canceled) {
          return;
        }

        const mapped = payload.items
          .map((item) => {
            const code = item.code.trim().toUpperCase();
            if (!code) {
              return null;
            }

            const category = item.category ?? "UNKNOWN";
            const categoryLabel = CORRELATION_CATEGORY_LABEL[category] ?? CORRELATION_CATEGORY_LABEL.UNKNOWN;
            const courseAbbr = item.courseAbbr?.trim() || inferCourseAbbreviation(null, item.courseCode);
            const searchText = normalizeDisciplineNameForComparison(
              `${code} ${item.name} ${courseAbbr} ${item.matrixCode} ${categoryLabel}`
            );

            return {
              key: `${item.matrixCode}:${code}`,
              code,
              name: item.name,
              category,
              categoryLabel,
              matrixCode: item.matrixCode,
              courseCode: item.courseCode,
              courseAbbr,
              catalogOnly: Boolean(item.catalogOnly),
              lookupValue: buildCorrelationLookupValue({
                code,
                name: item.name,
                courseAbbr,
                matrixCode: item.matrixCode,
                categoryLabel
              }),
              searchText
            } satisfies CorrelationLookupOption;
          })
          .filter((item): item is CorrelationLookupOption => Boolean(item))
          .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code) || a.matrixCode.localeCompare(b.matrixCode));

        setGlobalDisciplineLookupOptions(mapped);
      } catch {
        if (!canceled) {
          setGlobalDisciplineLookupOptions([]);
        }
      }
    };

    void loadDisciplineLookup();

    return () => {
      canceled = true;
    };
  }, []);

  const isSectionVisible = (section: RoadmapSectionKey | "review-manual"): boolean => {
    if (section === "review-manual") {
      return currentSection === "review";
    }
    return currentSection === section;
  };

  const plannerTrackOptions = useMemo(() => {
    if (!roadmap) {
      return [] as PlannerTrackOption[];
    }
    return getPlannerTrackOptions(roadmap);
  }, [roadmap]);

  useEffect(() => {
    if (!roadmap) {
      if (selectedPlannerTracks.length > 0) {
        setSelectedPlannerTracks([]);
      }
      return;
    }

    if (plannerTrackOptions.length === 0) {
      if (selectedPlannerTracks.length > 0) {
        setSelectedPlannerTracks([]);
      }
      return;
    }

    const validTrackKeys = new Set(plannerTrackOptions.map((item) => item.key));
    const sanitizedCurrent = selectedPlannerTracks.filter((track) => validTrackKeys.has(track));
    const fallbackInitiated = plannerTrackOptions.filter((item) => item.initiated).map((item) => item.key);
    const fallbackAll = plannerTrackOptions.map((item) => item.key);
    const fallbackDefault = fallbackInitiated.length > 0 ? fallbackInitiated : fallbackAll;
    const nextSelection = sanitizedCurrent.length > 0 ? sanitizedCurrent : fallbackDefault;

    if (!arraysEqual(selectedPlannerTracks, nextSelection)) {
      setSelectedPlannerTracks(nextSelection);
    }
  }, [plannerTrackOptions, roadmap, selectedPlannerTracks]);

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("pdf", file);

      const response = await fetch("/api/roadmap/parse", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Falha no parse do histórico."));
      }

      return (await response.json()) as ParsedTranscript;
    }
  });

  const calculateMutation = useMutation({
    mutationFn: async ({
      transcript,
      matrixCode,
      manualMappings
    }: {
      transcript: ParsedTranscript;
      matrixCode?: MatrixCode;
      manualMappings?: ManualCorrelationInput[];
    }) => {
      const response = await fetch("/api/roadmap/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parsedTranscript: transcript,
          matrixCode,
          manualMappings
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Falha no cálculo do roadmap."));
      }

      return ensureRoadmapShape((await response.json()) as RoadmapResult);
    }
  });

  const gradeMutation = useMutation({
    mutationFn: async ({
      matrixCode,
      pending,
      maxChs
    }: {
      matrixCode: MatrixCode;
      pending: string[];
      maxChs: number;
    }) => {
      const query = new URLSearchParams({
        matrix: matrixCode,
        course: resolveCourseCodeForMatrix(matrixCode, parsedTranscript?.student.courseCode),
        campus: resolveCampusCodeForMatrix(matrixCode),
        pending: pending.join(","),
        maxChs: String(maxChs)
      });

      const response = await fetch(`/api/grade/options?${query.toString()}`);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Falha na consulta de grade."));
      }

      return (await response.json()) as GradeOptionsResponse;
    }
  });

  const reportMutation = useMutation({
    mutationFn: async ({
      roadmapPayload,
      transcript,
      plannerSnapshot
    }: {
      roadmapPayload: RoadmapResult;
      transcript: ParsedTranscript;
      plannerSnapshot: Array<{
        periodIndex: number;
        totalChs: number;
        totalCht: number;
        disciplines: Array<{ code: string; name: string; cht: number; estimatedChs: number }>;
      }>;
    }) => {
      const response = await fetch("/api/report/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roadmap: roadmapPayload, parsedTranscript: transcript, plannerSnapshot })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Falha ao gerar PDF."));
      }

      return response.blob();
    }
  });

  const selectedPlannerTrackLabels = useMemo(() => {
    if (plannerTrackOptions.length === 0) {
      return [] as string[];
    }
    const selected = new Set(selectedPlannerTracks);
    return plannerTrackOptions.filter((item) => selected.has(item.key)).map((item) => item.label);
  }, [plannerTrackOptions, selectedPlannerTracks]);

  const assistantMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          matrixCode: activeMatrix || undefined,
          roadmap,
          parsedTranscript,
          gradeOptions,
          selectedTrackLabels: selectedPlannerTrackLabels,
          maxChsPerPeriod
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Falha ao consultar assistente."));
      }

      return (await response.json()) as AssistantChatResponse;
    }
  });

  const runCalculation = useCallback(async (
    transcript: ParsedTranscript,
    matrixCode?: MatrixCode,
    manualMappings?: ManualCorrelationInput[]
  ): Promise<void> => {
    const roadmapResult = await calculateMutation.mutateAsync({ transcript, matrixCode, manualMappings });
    setRoadmap(roadmapResult);
  }, [calculateMutation]);

  const reviewCategoryManualMappings = useMemo(
    () => buildManualMappingsFromReviewCategoryOverrides(parsedTranscript, reviewCategoryBySourceCode),
    [parsedTranscript, reviewCategoryBySourceCode]
  );

  const combinedManualMappings = useMemo(
    () => buildCombinedManualMappings(manualCorrelations, manualConvalidationMappings, reviewCategoryManualMappings),
    [manualConvalidationMappings, manualCorrelations, reviewCategoryManualMappings]
  );

  async function handleClearSnapshotAndReprocess(): Promise<void> {
    try {
      localStorage.removeItem(ROADMAP_WORKSPACE_STORAGE_KEY);
    } catch {
      // ignore local storage failures
    }

    setSnapshotRestoredFromLocalCache(false);
    setShowLegacySnapshotWarning(false);
    setErrorMessage(null);

    if (selectedFile) {
      await handleParseAndCalculate();
      return;
    }

    setParsedTranscript(null);
    setRoadmap(null);
    setGradeOptions(null);
    setActiveMatrix("");
    setManualCorrelations({});
    setManualConvalidationMappings({});
    setReviewCategoryBySourceCode({});
    setUnusedInlineTargetBySource({});
    setUnusedInlineCategoryBySource({});
    setUnusedInlineChtBySource({});
    setUnusedInlineManualOnlyBySource({});
    setUnusedInlineManualNameBySource({});
    setUnusedInlineManualCodeBySource({});
    setUnusedConvalidationNotice(null);
    setUnusedConvalidationError(null);
    setErrorMessage("Snapshot local antigo removido. Reenvie o histórico para reprocessar com o parser atual.");
  }

  async function handleParseAndCalculate(): Promise<void> {
    if (!selectedFile) {
      setErrorMessage("Selecione um arquivo PDF antes de enviar.");
      return;
    }

    try {
      setErrorMessage(null);
      setGradeOptions(null);
      setRoadmap(null);
      setSnapshotRestoredFromLocalCache(false);
      setShowLegacySnapshotWarning(false);
      const parsed = await parseMutation.mutateAsync(selectedFile);
      const parseValidationError = buildParseValidationError(parsed);
      if (parseValidationError) {
        setParsedTranscript(parsed);
        setErrorMessage(parseValidationError);
        return;
      }

      setParsedTranscript(parsed);
      setManualCorrelations({});
      setManualConvalidationMappings({});
      setReviewCategoryBySourceCode({});
      setUnusedInlineTargetBySource({});
      setUnusedInlineCategoryBySource({});
      setUnusedInlineChtBySource({});
      setUnusedInlineManualOnlyBySource({});
      setUnusedInlineManualNameBySource({});
      setUnusedInlineManualCodeBySource({});
      setUnusedConvalidationNotice(null);
      setUnusedConvalidationError(null);

      const matrix =
        (parsed.detectedMatrixCode && isSupportedMatrixCode(parsed.detectedMatrixCode) ? parsed.detectedMatrixCode : null) ??
        inferMatrixCodeFromCourseCode(parsed.student.courseCode) ??
        "981";
      setActiveMatrix(matrix);
      await runCalculation(parsed, matrix);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  async function handleRecalculate(matrixCode: MatrixCode): Promise<void> {
    if (!parsedTranscript) {
      return;
    }

    try {
      setErrorMessage(null);
      setActiveMatrix(matrixCode);
      await runCalculation(parsedTranscript, matrixCode, combinedManualMappings);
      setGradeOptions(null);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  async function handleApplyManualCorrelations(): Promise<void> {
    if (!parsedTranscript || !activeMatrix) {
      return;
    }

    const mappings: ManualCorrelationInput[] = combinedManualMappings;

    if (mappings.length === 0) {
      setErrorMessage("Preencha ao menos um código de destino para aplicar a correlação manual.");
      return;
    }

    try {
      setErrorMessage(null);
      setGradeOptions(null);
      await runCalculation(parsedTranscript, activeMatrix, mappings);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  function toggleCalculationCategory(category: CalculationCategory): void {
    setEnabledCalculationCategories((current) => {
      if (current.includes(category)) {
        return current.filter((item) => item !== category);
      }
      return [...current, category];
    });
  }

  function selectAllCalculationCategories(): void {
    setEnabledCalculationCategories([...availableCalculationCategories]);
  }

  async function handleReviewCategoryOverrideChange(
    sourceCodeRaw: string,
    nextCategory: CorrelationCategory | ""
  ): Promise<void> {
    const sourceCode = normalizeManualTargetCode(sourceCodeRaw);
    if (!sourceCode) {
      return;
    }
    if (nextCategory && !correlationCategoryOptions.includes(nextCategory)) {
      return;
    }

    const nextOverrides: Record<string, CorrelationCategory> = {
      ...reviewCategoryBySourceCode
    };

    if (!nextCategory) {
      delete nextOverrides[sourceCode];
    } else {
      nextOverrides[sourceCode] = nextCategory;
    }

    setReviewCategoryBySourceCode(nextOverrides);

    if (!parsedTranscript || !activeMatrix) {
      return;
    }

    try {
      setErrorMessage(null);
      setGradeOptions(null);
      const nextReviewMappings = buildManualMappingsFromReviewCategoryOverrides(parsedTranscript, nextOverrides);
      const nextMappings = buildCombinedManualMappings(manualCorrelations, manualConvalidationMappings, nextReviewMappings);
      await runCalculation(parsedTranscript, activeMatrix, nextMappings);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  function resolveConvalidationTarget(
    source: { code: string; name: string },
    preferredInput: string,
    matrixToUse: MatrixCode
  ): { target: CorrelationLookupOption | null; error?: string } {
    const scoped = convalidationLookupOptions.filter((item) => item.matrixCode === matrixToUse);
    const trimmedInput = preferredInput.trim();

    if (trimmedInput) {
      const targetCode = extractTargetCodeFromLookupValue(trimmedInput);
      if (!targetCode) {
        return { target: null, error: "Destino inválido no lookup. Selecione uma opção com código." };
      }

      const byCode = scoped.filter((item) => item.code === targetCode);
      if (byCode.length > 0) {
        const normalizedInput = trimmedInput.toUpperCase();
        const explicit =
          byCode.find(
            (item) => item.lookupValue.toUpperCase() === normalizedInput || `${item.code} - ${item.name}`.toUpperCase() === normalizedInput
          ) ?? null;
        return { target: explicit ?? byCode[0] };
      }

      const globalByCode = convalidationLookupOptions.filter((item) => item.code === targetCode);
      const externalMatch = globalByCode[0] ?? null;
      if (externalMatch) {
        const normalizedExternalName = normalizeDisciplineNameForComparison(externalMatch.name);
        const byNameInActive = scoped.filter((item) => normalizeDisciplineNameForComparison(item.name) === normalizedExternalName);
        if (byNameInActive.length === 1) {
          return { target: byNameInActive[0] };
        }
      }

      return { target: null, error: `Código ${targetCode} não existe na matriz ativa ${matrixToUse}.` };
    }

    const byLikelyName = scoped.filter((item) => disciplineNamesLikelyMatch(source.name, item.name));
    if (byLikelyName.length === 1) {
      return { target: byLikelyName[0] };
    }

    const normalizedSourceName = normalizeDisciplineNameForComparison(source.name);
    const byExactNormalized = scoped.filter((item) => normalizeDisciplineNameForComparison(item.name) === normalizedSourceName);
    if (byExactNormalized.length === 1) {
      return { target: byExactNormalized[0] };
    }

    return { target: null, error: `Sem correspondência única para ${source.code}. Escolha o destino manualmente.` };
  }

  async function applyUnusedConvalidationMappings(
    mappings: Record<string, ManualCorrelationInput>,
    matrixToUse: MatrixCode,
    successMessage?: string
  ): Promise<void> {
    if (!parsedTranscript) {
      return;
    }

    const nextManualConvalidationMappings = {
      ...manualConvalidationMappings,
      ...mappings
    };

    setErrorMessage(null);
    setUnusedConvalidationNotice(null);
    setUnusedConvalidationError(null);
    setManualConvalidationMappings(nextManualConvalidationMappings);
    setGradeOptions(null);
    await runCalculation(
      parsedTranscript,
      matrixToUse,
      buildCombinedManualMappings(manualCorrelations, nextManualConvalidationMappings, reviewCategoryManualMappings)
    );
    if (successMessage) {
      setUnusedConvalidationNotice(successMessage);
    }
  }

  function buildUnusedInlineManualMapping(
    source: { code: string; name: string; cht: number },
    matrixToUse: MatrixCode
  ): { mapping: ManualCorrelationInput | null; target: CorrelationLookupOption | null; error?: string } {
    const manualOnly = Boolean(unusedInlineManualOnlyBySource[source.code]);
    const suggestedCategory = unusedAutomaticSuggestionBySource[source.code]?.category;
    const fallbackCategory =
      suggestedCategory && correlationCategoryOptions.includes(suggestedCategory)
        ? suggestedCategory
        : fallbackCorrelationCategory;
    const targetCategory = (unusedInlineCategoryBySource[source.code] ?? fallbackCategory) as CorrelationCategory;
    const rawHours = Number(unusedInlineChtBySource[source.code] ?? String(source.cht));
    const creditedCHT = Number.isFinite(rawHours) ? Math.max(Math.round(rawHours), 0) : Math.max(source.cht, 0);

    if (creditedCHT <= 0) {
      return { mapping: null, target: null, error: `CHT inválida para ${source.code}. Informe um valor maior que zero.` };
    }

    let target: CorrelationLookupOption | null = null;
    if (!manualOnly) {
      const preferredInput = unusedInlineTargetBySource[source.code] ?? "";
      const resolved = resolveConvalidationTarget(source, preferredInput, matrixToUse);
      if (!resolved.target) {
        return { mapping: null, target: null, error: resolved.error ?? `Não foi possível convalidar ${source.code}.` };
      }
      target = resolved.target;
    }

    const manualName = (unusedInlineManualNameBySource[source.code] ?? "").trim() || source.name;
    const manualCodeNormalized = normalizeManualTargetCode(unusedInlineManualCodeBySource[source.code] ?? "");

    const mapping: ManualCorrelationInput = {
      sourceCode: source.code,
      sourceName: source.name,
      targetCode: target?.code,
      targetCategory,
      creditedCHT,
      manualOnly,
      customDisciplineName: manualOnly ? manualName : undefined,
      customDisciplineCode: manualOnly && manualCodeNormalized ? manualCodeNormalized : undefined
    };

    return { mapping, target };
  }

  async function handleConvalidateUnusedRow(sourceCode: string): Promise<void> {
    if (!roadmap) {
      return;
    }

    const matrixToUse = (activeMatrix || roadmap.matrixCode) as MatrixCode;
    const source = unusedConvalidationSourceOptions.find((item) => item.code === sourceCode);
    if (!source) {
      setUnusedConvalidationNotice(null);
      setUnusedConvalidationError(`Origem ${sourceCode} não encontrada na lista de não utilizadas.`);
      setErrorMessage(`Origem ${sourceCode} não encontrada na lista de não utilizadas.`);
      return;
    }

    const resolved = buildUnusedInlineManualMapping(source, matrixToUse);
    if (!resolved.mapping) {
      setUnusedConvalidationNotice(null);
      setUnusedConvalidationError(resolved.error ?? `Não foi possível convalidar ${source.code}.`);
      setErrorMessage(resolved.error ?? `Não foi possível convalidar ${source.code}.`);
      return;
    }
    const target = resolved.target;
    const mapping = resolved.mapping;

    try {
      await applyUnusedConvalidationMappings(
        { [source.code]: mapping },
        matrixToUse,
        `${source.code} convalidada${target ? ` como ${target.code}` : " manualmente"} (${mapping.targetCategory ?? fallbackCorrelationCategory}, ${mapping.creditedCHT ?? 0}h).`
      );
      if (target) {
        setUnusedInlineTargetBySource((current) => ({ ...current, [source.code]: target.lookupValue }));
      }
    } catch (error) {
      setUnusedConvalidationNotice(null);
      setUnusedConvalidationError((error as Error).message);
      setErrorMessage((error as Error).message);
    }
  }

  async function handleConvalidateAllUnused(): Promise<void> {
    if (!roadmap) {
      return;
    }

    const matrixToUse = (activeMatrix || roadmap.matrixCode) as MatrixCode;
    const mappings: Record<string, ManualCorrelationInput> = {};
    const failures: string[] = [];

    for (const source of unusedConvalidationSourceOptions) {
      const resolved = buildUnusedInlineManualMapping(source, matrixToUse);
      if (!resolved.mapping) {
        failures.push(source.code);
        continue;
      }
      mappings[source.code] = resolved.mapping;
    }

    const entries = Object.entries(mappings);
    if (entries.length === 0) {
      setUnusedConvalidationNotice(null);
      setUnusedConvalidationError("Nenhuma convalidação automática foi aplicada. Revise os destinos na tabela.");
      setErrorMessage("Nenhuma convalidação automática foi aplicada. Revise os destinos na tabela.");
      return;
    }

    try {
      await applyUnusedConvalidationMappings(
        mappings,
        matrixToUse,
        `Convalidação em lote aplicada para ${entries.length} disciplina(s).${failures.length > 0 ? ` Sem correspondência: ${failures.join(", ")}.` : ""}`
      );
    } catch (error) {
      setUnusedConvalidationNotice(null);
      setUnusedConvalidationError((error as Error).message);
      setErrorMessage((error as Error).message);
    }
  }

  async function handleLoadGrade(): Promise<void> {
    if (!roadmap || !activeMatrix) {
      return;
    }

    try {
      setErrorMessage(null);
      const pendingCodes = plannerPendingDisciplines.map((item) => item.code);
      const result = await gradeMutation.mutateAsync({
        matrixCode: activeMatrix,
        pending: pendingCodes,
        maxChs: maxChsPerPeriod
      });
      setGradeOptions(result);
      setSelectedPlanPeriod(result.graduationPlan.periods[0]?.periodIndex ?? 1);
      setManualPlan(
        result.graduationPlan.periods.reduce<Record<number, string[]>>((acc, period) => {
          acc[period.periodIndex] = period.disciplines.map((discipline) => discipline.code);
          return acc;
        }, {})
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  function applyPlannerTrackSelection(nextTracks: string[]): void {
    const normalized = nextTracks
      .map((track) => normalizeTrackLabel(track))
      .filter((track, index, array) => array.indexOf(track) === index);
    const fallbackInitiated = plannerTrackOptions.filter((track) => track.initiated).map((track) => track.key);
    const fallbackAll = plannerTrackOptions.map((track) => track.key);
    const fallbackDefault = fallbackInitiated.length > 0 ? fallbackInitiated : fallbackAll;
    const resolved = normalized.length > 0 ? normalized : fallbackDefault;

    if (arraysEqual(selectedPlannerTracks, resolved)) {
      return;
    }

    setSelectedPlannerTracks(resolved);
    setGradeOptions(null);
    setManualPlan({});
    setSelectedPlanPeriod(1);
  }

  function togglePlannerTrack(trackKey: string): void {
    if (selectedPlannerTracks.includes(trackKey) && selectedPlannerTracks.length === 1) {
      return;
    }

    if (selectedPlannerTracks.includes(trackKey)) {
      applyPlannerTrackSelection(selectedPlannerTracks.filter((item) => item !== trackKey));
      return;
    }

    applyPlannerTrackSelection([...selectedPlannerTracks, trackKey]);
  }

  function moveCodeToPeriod(code: string, targetPeriod: number | null): void {
    setManualPlan((current) => {
      const next: Record<number, string[]> = {};
      for (const [key, list] of Object.entries(current)) {
        next[Number(key)] = list.filter((item) => item !== code);
      }

      if (targetPeriod !== null) {
        const target = next[targetPeriod] ?? [];
        next[targetPeriod] = [...target, code];
      }

      return next;
    });
  }

  function appendAssistantMessage(message: AssistantMessage): void {
    setAssistantMessages((current) => [...current, message]);
  }

  function applyAssistantPlanPatch(patch: AssistantPlanPatch): void {
    setSelectedPlanPeriod(patch.periodIndex);
    setManualPlan((current) => {
      const next: Record<number, string[]> = {};
      const picked = patch.payload.disciplines;

      for (const [key, codes] of Object.entries(current)) {
        const periodKey = Number(key);
        next[periodKey] = codes.filter((code) => !picked.includes(code));
      }

      const existingTarget = next[patch.periodIndex] ?? [];
      const merged = [...existingTarget, ...picked].filter((code, index, arr) => arr.indexOf(code) === index);
      next[patch.periodIndex] = merged;
      return next;
    });
  }

  function applyAssistantProposal(proposal: AssistantPlanProposal): void {
    applyAssistantPlanPatch(proposal.patch);
    appendAssistantMessage({
      id: `assistant-applied-${Date.now()}`,
      role: "assistant",
      text: `Proposta aplicada no período ${proposal.periodIndex}: ${proposal.achievedChs} CHS com ${proposal.subjectsCount} matéria(s).`,
      createdAt: new Date().toISOString()
    });
  }

  async function submitAssistantMessage(content: string): Promise<void> {
    if (!content) {
      return;
    }

    appendAssistantMessage({
      id: `assistant-user-${Date.now()}`,
      role: "user",
      text: content,
      createdAt: new Date().toISOString()
    });
    setAssistantInput("");

    try {
      const result = await assistantMutation.mutateAsync(content);
      appendAssistantMessage({
        id: `assistant-bot-${Date.now()}`,
        role: "assistant",
        text: result.answer,
        action: result.action,
        proposals: result.proposals,
        question: result.question,
        planPatch: result.planPatch,
        providerUsed: result.providerUsed,
        diagnostics: result.diagnostics,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      appendAssistantMessage({
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        text: `Erro ao processar sua solicitação: ${(error as Error).message}`,
        createdAt: new Date().toISOString()
      });
    }
  }

  async function handleAssistantSend(): Promise<void> {
    const content = assistantInput.trim();
    await submitAssistantMessage(content);
  }

  function buildPeriodFollowUpMessage(periodIndex: number, questionMessageId: string): string {
    const askIndex = assistantMessages.findIndex((message) => message.id === questionMessageId);
    if (askIndex <= 0) {
      return `Quero montar o período ${periodIndex}.`;
    }

    for (let index = askIndex - 1; index >= 0; index -= 1) {
      const candidate = assistantMessages[index];
      if (candidate.role !== "user") {
        continue;
      }
      return `${candidate.text}\nQuero montar o período ${periodIndex}.`;
    }

    return `Quero montar o período ${periodIndex}.`;
  }

  async function handleAssistantPeriodReply(periodIndex: number, questionMessageId: string): Promise<void> {
    await submitAssistantMessage(buildPeriodFollowUpMessage(periodIndex, questionMessageId));
  }


  useEffect(() => {
    const exportState = {
      canExportJson: Boolean(roadmap),
      canExportPdf: Boolean(roadmap && parsedTranscript),
      pdfBusy: reportMutation.isPending
    };

    try {
      localStorage.setItem(ROADMAP_WORKSPACE_EXPORT_STATE_KEY, JSON.stringify(exportState));
      window.dispatchEvent(new CustomEvent(ROADMAP_EXPORT_STATE_UPDATED_EVENT));
    } catch {
      // ignore local storage failures for toolbar state
    }
  }, [parsedTranscript, reportMutation.isPending, roadmap]);

  const enabledCalculationCategorySet = useMemo(
    () => new Set<CalculationCategory>(enabledCalculationCategories),
    [enabledCalculationCategories]
  );
  const availableCalculationCategorySet = useMemo(
    () => new Set<CalculationCategory>(availableCalculationCategories),
    [availableCalculationCategories]
  );

  const excludedCalculationCategoryLabels = useMemo(
    () =>
      calculationFilterOptions.filter((option) => !enabledCalculationCategorySet.has(option.category)).map((option) => option.label),
    [calculationFilterOptions, enabledCalculationCategorySet]
  );

  const calculationProgressBuckets = useMemo(() => {
    if (!roadmap) {
      return [] as RoadmapResult["progress"];
    }

    const byKey = new Map(roadmap.progress.map((bucket) => [bucket.key, bucket]));
    const nodes = roadmap.prereqGraph.nodes.filter((node) => node.status !== "OUTSIDE_SCOPE");
    const getOrZeroBucket = (
      key: RoadmapResult["progress"][number]["key"],
      label: string,
      enabled: boolean
    ): RoadmapResult["progress"][number] => {
      const source = byKey.get(key);
      if (!enabled) {
        return {
          key,
          label: source?.label ?? label,
          requiredCHT: 0,
          completedCHT: 0,
          validatedCHT: 0,
          missingCHT: 0
        };
      }

      return (
        source ?? {
          key,
          label,
          requiredCHT: 0,
          completedCHT: 0,
          validatedCHT: 0,
          missingCHT: 0
        }
      );
    };

    const sumNodeCht = (categories: CorrelationCategory[], doneOnly = false): number =>
      nodes.reduce((sum, node) => {
        if (!categories.includes(node.category)) {
          return sum;
        }
        if (doneOnly && node.status !== "DONE") {
          return sum;
        }
        return sum + node.cht;
      }, 0);

    const mandatory = getOrZeroBucket(
      "mandatory",
      "Obrigatórias",
      availableCalculationCategorySet.has("MANDATORY") && enabledCalculationCategorySet.has("MANDATORY")
    );
    const optionalOrTrackExists = availableCalculationCategorySet.has("OPTIONAL") || availableCalculationCategorySet.has("TRACK");
    const optionalAndTrackEnabled =
      (availableCalculationCategorySet.has("OPTIONAL") && enabledCalculationCategorySet.has("OPTIONAL")) ||
      (availableCalculationCategorySet.has("TRACK") && enabledCalculationCategorySet.has("TRACK"));
    const optionalAndTrackFullyEnabled = enabledCalculationCategorySet.has("OPTIONAL") && enabledCalculationCategorySet.has("TRACK");
    const optionalLabel = optionalAndTrackFullyEnabled
      ? "Optativas + Trilhas"
      : enabledCalculationCategorySet.has("TRACK")
        ? "Trilhas"
        : "Optativas";
    const optionalFromRoadmap = getOrZeroBucket("optional", optionalLabel, optionalOrTrackExists && optionalAndTrackEnabled);
    const optionalCategories = [
      ...(availableCalculationCategorySet.has("OPTIONAL") && enabledCalculationCategorySet.has("OPTIONAL")
        ? (["OPTIONAL"] as CorrelationCategory[])
        : []),
      ...(availableCalculationCategorySet.has("TRACK") && enabledCalculationCategorySet.has("TRACK")
        ? (["TRACK"] as CorrelationCategory[])
        : [])
    ];
    const optionalFromNodesValidatedRaw = sumNodeCht(optionalCategories, true);
    const optionalRequiredCHT =
      (availableCalculationCategorySet.has("OPTIONAL") && enabledCalculationCategorySet.has("OPTIONAL")
        ? optionalNonTrackRequiredCHT
        : 0) +
      (availableCalculationCategorySet.has("TRACK") && enabledCalculationCategorySet.has("TRACK") ? trackRequiredCHT : 0);
    const optionalFromNodesValidated = Math.min(optionalFromNodesValidatedRaw, optionalRequiredCHT);
    const optional: RoadmapResult["progress"][number] =
      optionalAndTrackEnabled && !optionalAndTrackFullyEnabled
        ? {
            key: "optional",
            label: optionalLabel,
            requiredCHT: optionalRequiredCHT,
            completedCHT: optionalFromNodesValidated,
            validatedCHT: optionalFromNodesValidated,
            missingCHT: Math.max(optionalRequiredCHT - optionalFromNodesValidated, 0)
          }
        : {
            ...optionalFromRoadmap,
            label: optionalLabel
          };

    const buckets: RoadmapResult["progress"] = [];
    if (availableCalculationCategorySet.has("MANDATORY")) {
      buckets.push(mandatory);
    }
    if (optionalOrTrackExists) {
      buckets.push(optional);
    }
    if (availableCalculationCategorySet.has("ELECTIVE")) {
      buckets.push(getOrZeroBucket("elective", "Eletivas", enabledCalculationCategorySet.has("ELECTIVE")));
    }
    if (availableCalculationCategorySet.has("COMPLEMENTARY")) {
      buckets.push(
        getOrZeroBucket("complementary", "Atividades Complementares", enabledCalculationCategorySet.has("COMPLEMENTARY"))
      );
    }
    if (availableCalculationCategorySet.has("INTERNSHIP")) {
      buckets.push(getOrZeroBucket("internship", "Estágio", enabledCalculationCategorySet.has("INTERNSHIP")));
    }
    if (availableCalculationCategorySet.has("TCC")) {
      buckets.push(getOrZeroBucket("tcc", "TCC", enabledCalculationCategorySet.has("TCC")));
    }
    if (availableCalculationCategorySet.has("EXTENSION")) {
      buckets.push(getOrZeroBucket("extension", "Atividades Extensionistas", enabledCalculationCategorySet.has("EXTENSION")));
    }

    return buckets;
  }, [availableCalculationCategorySet, enabledCalculationCategorySet, optionalNonTrackRequiredCHT, roadmap, trackRequiredCHT]);
  const chartProgressBuckets = useMemo(() => calculationProgressBuckets, [calculationProgressBuckets]);

  const progressChartData = useMemo<ChartData<"bar"> | null>(() => {
    if (chartProgressBuckets.length === 0) {
      return null;
    }

    return {
      labels: chartProgressBuckets.map((item) => item.label),
      datasets: [
        {
          label: "CHT Validada",
          data: chartProgressBuckets.map((item) => item.validatedCHT),
          backgroundColor: "rgba(0, 210, 106, 0.75)"
        },
        {
          label: "CHT Faltante",
          data: chartProgressBuckets.map((item) => item.missingCHT),
          backgroundColor: "rgba(255, 184, 0, 0.72)"
        }
      ]
    };
  }, [chartProgressBuckets]);

  const graphStatusSummary = useMemo(() => {
    if (!roadmap) {
      return { done: 0, available: 0, blocked: 0, outside: 0 };
    }

    return roadmap.prereqGraph.nodes.reduce(
      (acc, node) => {
        if (node.status === "DONE") acc.done += 1;
        if (node.status === "AVAILABLE") acc.available += 1;
        if (node.status === "BLOCKED") acc.blocked += 1;
        if (node.status === "OUTSIDE_SCOPE") acc.outside += 1;
        return acc;
      },
      { done: 0, available: 0, blocked: 0, outside: 0 }
    );
  }, [roadmap]);

  const correlationLookupOptions = useMemo(() => {
    if (!roadmap) {
      return [] as CorrelationLookupOption[];
    }

    const syntheticPattern = /^ELV[PD]\d{3}C\d{3}$/;
    const fallbackMatrixCode = effectiveMatrixCode;
    const fallbackCourseCode = resolveCourseCodeForMatrix(fallbackMatrixCode, parsedTranscript?.student.courseCode);
    const fallbackCourseAbbr = inferCourseAbbreviation(parsedTranscript?.student.courseName, fallbackCourseCode);
    const byCode = new Map<string, CorrelationLookupOption>();

    for (const node of roadmap.prereqGraph.nodes) {
      const code = node.code.trim().toUpperCase();
      if (!code || syntheticPattern.test(code)) {
        continue;
      }

      byCode.set(code, {
        key: `${fallbackMatrixCode}:${code}`,
        code,
        name: node.name,
        category: node.category,
        categoryLabel: CORRELATION_CATEGORY_LABEL[node.category] ?? CORRELATION_CATEGORY_LABEL.UNKNOWN,
        matrixCode: fallbackMatrixCode,
        courseCode: fallbackCourseCode,
        courseAbbr: fallbackCourseAbbr,
        catalogOnly: false,
        lookupValue: buildCorrelationLookupValue({
          code,
          name: node.name,
          courseAbbr: fallbackCourseAbbr,
          matrixCode: fallbackMatrixCode,
          categoryLabel: CORRELATION_CATEGORY_LABEL[node.category] ?? CORRELATION_CATEGORY_LABEL.UNKNOWN
        }),
        searchText: normalizeDisciplineNameForComparison(
          `${code} ${node.name} ${fallbackCourseAbbr} ${fallbackMatrixCode} ${
            CORRELATION_CATEGORY_LABEL[node.category] ?? CORRELATION_CATEGORY_LABEL.UNKNOWN
          }`
        )
      });
    }

    for (const option of roadmap.electiveOptions ?? []) {
      const code = option.code.trim().toUpperCase();
      if (!code || syntheticPattern.test(code) || byCode.has(code)) {
        continue;
      }

      byCode.set(code, {
        key: `${fallbackMatrixCode}:${code}`,
        code,
        name: option.name,
        category: "ELECTIVE",
        categoryLabel: CORRELATION_CATEGORY_LABEL.ELECTIVE,
        matrixCode: fallbackMatrixCode,
        courseCode: fallbackCourseCode,
        courseAbbr: fallbackCourseAbbr,
        catalogOnly: false,
        lookupValue: buildCorrelationLookupValue({
          code,
          name: option.name,
          courseAbbr: fallbackCourseAbbr,
          matrixCode: fallbackMatrixCode,
          categoryLabel: CORRELATION_CATEGORY_LABEL.ELECTIVE
        }),
        searchText: normalizeDisciplineNameForComparison(
          `${code} ${option.name} ${fallbackCourseAbbr} ${fallbackMatrixCode} ${CORRELATION_CATEGORY_LABEL.ELECTIVE}`
        )
      });
    }

    return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  }, [effectiveMatrixCode, parsedTranscript?.student.courseCode, parsedTranscript?.student.courseName, roadmap]);

  const manualCorrelationTargetOptions = useMemo(
    () =>
      correlationLookupOptions.map((item) => ({
        code: item.code,
        label: `${item.code} - ${item.name}`
      })),
    [correlationLookupOptions]
  );

  const convalidationLookupOptions = useMemo(() => {
    if (globalDisciplineLookupOptions.length > 0) {
      return globalDisciplineLookupOptions;
    }
    return correlationLookupOptions;
  }, [correlationLookupOptions, globalDisciplineLookupOptions]);

  const unusedConvalidationSourceOptions = useMemo(() => {
    if (!roadmap) {
      return [];
    }
    return roadmap.unusedDisciplines.filter((item) => item.code.toUpperCase() !== "ELETIVAS");
  }, [roadmap]);

  const unusedAutomaticSuggestionBySource = useMemo(() => {
    if (!roadmap) {
      return {} as Record<string, CorrelationLookupOption | null>;
    }
    const matrixToUse = (activeMatrix || roadmap.matrixCode) as MatrixCode;
    const scoped = convalidationLookupOptions.filter((item) => item.matrixCode === matrixToUse);
    const output: Record<string, CorrelationLookupOption | null> = {};
    const suggestionBySourceCode = new Map(
      roadmap.unmatchedApprovedAttempts.map((attempt) => [normalizeManualTargetCode(attempt.sourceCode), attempt.suggestedTargets])
    );

    for (const source of unusedConvalidationSourceOptions) {
      const officialSuggestions = suggestionBySourceCode.get(normalizeManualTargetCode(source.code)) ?? [];
      const officialEquivalence = officialSuggestions.find((suggestion) => suggestion.strategy === "EQUIVALENCE");
      if (officialEquivalence) {
        const lookupByCode = scoped.find((item) => item.code === officialEquivalence.code) ?? null;
        if (lookupByCode) {
          output[source.code] = lookupByCode;
          continue;
        }
      }

      const byLikelyName = scoped.filter((item) => disciplineNamesLikelyMatch(source.name, item.name));
      if (byLikelyName.length === 1) {
        output[source.code] = byLikelyName[0];
        continue;
      }

      const normalizedSourceName = normalizeDisciplineNameForComparison(source.name);
      const exactNormalized = scoped.filter((item) => normalizeDisciplineNameForComparison(item.name) === normalizedSourceName);
      if (exactNormalized.length === 1) {
        output[source.code] = exactNormalized[0];
        continue;
      }

      output[source.code] = null;
    }

    return output;
  }, [activeMatrix, convalidationLookupOptions, roadmap, unusedConvalidationSourceOptions]);

  useEffect(() => {
    if (unusedConvalidationSourceOptions.length === 0) {
      setUnusedInlineTargetBySource({});
      setUnusedInlineCategoryBySource({});
      setUnusedInlineChtBySource({});
      setUnusedInlineManualOnlyBySource({});
      setUnusedInlineManualNameBySource({});
      setUnusedInlineManualCodeBySource({});
      return;
    }

    setUnusedInlineTargetBySource((current) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const source of unusedConvalidationSourceOptions) {
        const existing = current[source.code];
        if (existing) {
          next[source.code] = existing;
          continue;
        }

        const automatic = unusedAutomaticSuggestionBySource[source.code];
        if (automatic) {
          next[source.code] = automatic.lookupValue;
          changed = true;
        } else if (source.code in current) {
          changed = true;
        }
      }

      if (!changed && Object.keys(current).length === Object.keys(next).length) {
        return current;
      }
      return next;
    });

    setUnusedInlineCategoryBySource((current) => {
      const next: Record<string, CorrelationCategory> = {};
      for (const source of unusedConvalidationSourceOptions) {
        const suggestedCategory = unusedAutomaticSuggestionBySource[source.code]?.category;
        const fallback =
          suggestedCategory && correlationCategoryOptions.includes(suggestedCategory)
            ? suggestedCategory
            : fallbackCorrelationCategory;
        const existing = current[source.code];
        next[source.code] = existing && correlationCategoryOptions.includes(existing) ? existing : fallback;
      }
      return next;
    });

    setUnusedInlineChtBySource((current) => {
      const next: Record<string, string> = {};
      for (const source of unusedConvalidationSourceOptions) {
        next[source.code] = current[source.code] ?? String(Math.max(source.cht, 0));
      }
      return next;
    });

    setUnusedInlineManualOnlyBySource((current) => {
      const next: Record<string, boolean> = {};
      for (const source of unusedConvalidationSourceOptions) {
        next[source.code] = current[source.code] ?? false;
      }
      return next;
    });

    setUnusedInlineManualNameBySource((current) => {
      const next: Record<string, string> = {};
      for (const source of unusedConvalidationSourceOptions) {
        next[source.code] = current[source.code] ?? source.name;
      }
      return next;
    });

    setUnusedInlineManualCodeBySource((current) => {
      const next: Record<string, string> = {};
      for (const source of unusedConvalidationSourceOptions) {
        next[source.code] = current[source.code] ?? "";
      }
      return next;
    });
  }, [correlationCategoryOptions, fallbackCorrelationCategory, unusedAutomaticSuggestionBySource, unusedConvalidationSourceOptions]);

  const unusedConvalidationTargetOptions = useMemo(() => {
    return [...convalidationLookupOptions]
      .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code) || a.matrixCode.localeCompare(b.matrixCode))
      .slice(0, 2000);
  }, [convalidationLookupOptions]);

  const reviewAutoCategoryBySourceCode = useMemo(() => {
    const output: Record<string, CorrelationCategory> = {};

    if (!roadmap) {
      return output;
    }

    for (const node of roadmap.prereqGraph.nodes) {
      const code = normalizeManualTargetCode(node.code);
      if (!code) {
        continue;
      }
      output[code] = node.category;
    }

    for (const option of roadmap.electiveOptions ?? []) {
      const code = normalizeManualTargetCode(option.code);
      if (!code || output[code]) {
        continue;
      }
      output[code] = "ELECTIVE";
    }

    return output;
  }, [roadmap]);

  const roadmapForCalculationView = useMemo(() => {
    if (!roadmap) {
      return null;
    }

    const filteredNodes = roadmap.prereqGraph.nodes.filter(
      (node) => node.category !== "UNKNOWN" && enabledCalculationCategorySet.has(node.category as CalculationCategory)
    );
    const filteredCodes = new Set(filteredNodes.map((node) => node.code));
    const filteredEdges = roadmap.prereqGraph.edges.filter((edge) => filteredCodes.has(edge.from) && filteredCodes.has(edge.to));
    const filteredPending = roadmap.pending.filter(
      (item) => item.category !== "UNKNOWN" && enabledCalculationCategorySet.has(item.category as CalculationCategory)
    );
    const filteredElectiveOptions = enabledCalculationCategorySet.has("ELECTIVE") ? roadmap.electiveOptions ?? [] : [];

    return {
      ...roadmap,
      progress: calculationProgressBuckets,
      pending: filteredPending,
      prereqGraph: {
        nodes: filteredNodes,
        edges: filteredEdges
      },
      electiveOptions: filteredElectiveOptions
    } satisfies RoadmapResult;
  }, [calculationProgressBuckets, enabledCalculationCategorySet, roadmap]);

  const sectorTables = useMemo(() => {
    if (!roadmap) {
      return [];
    }

    const electiveBucket = calculationProgressBuckets.find((bucket) => bucket.key === "elective");
    const optionalBucket = calculationProgressBuckets.find((bucket) => bucket.key === "optional");
    const activeDefinitions = sectorDefinitions.filter((definition) => {
      if (definition.category === "OPTIONAL") {
        return enabledCalculationCategorySet.has("OPTIONAL") || enabledCalculationCategorySet.has("TRACK");
      }
      return enabledCalculationCategorySet.has(definition.category);
    });

    return activeDefinitions.map((definition) => {
      if (definition.category === "ELECTIVE" && (roadmap.electiveOptions?.length ?? 0) > 0) {
        const allRows = (roadmap.electiveOptions ?? [])
          .map((option) => ({
            code: option.code,
            name: option.name,
            status: option.status,
            category: "ELECTIVE" as const,
            subcategory: "Eletivas da Matriz",
            track: undefined,
            recommendedPeriod: option.recommendedPeriod,
            cht: option.cht,
            prerequisites: [],
            dependents: []
          }))
          .sort((a, b) => (a.recommendedPeriod ?? 99) - (b.recommendedPeriod ?? 99) || a.code.localeCompare(b.code));

        const doneRows = allRows.filter((node) => node.status === "DONE");
        const missingRows = allRows.filter((node) => node.status !== "DONE");
        const rows = [...missingRows, ...doneRows];
        const requiredMissingCHT = electiveBucket?.missingCHT ?? 0;

        return {
          key: definition.category,
          label: definition.label,
          rows,
          completedCount: doneRows.length,
          missingCount: Math.ceil(requiredMissingCHT / 15),
          missingCHT: requiredMissingCHT,
          optionsCount: allRows.length,
          usesElectiveCatalog: true
        };
      }

      const nodes = roadmap.prereqGraph.nodes
        .filter((node) => {
          if (definition.category === "OPTIONAL") {
            if (node.category === "OPTIONAL") {
              return enabledCalculationCategorySet.has("OPTIONAL");
            }
            if (node.category === "TRACK") {
              return enabledCalculationCategorySet.has("TRACK");
            }
            return false;
          }
          return node.category === definition.category;
        })
        .sort((a, b) => (a.recommendedPeriod ?? 99) - (b.recommendedPeriod ?? 99) || a.code.localeCompare(b.code));

      const doneRows = nodes.filter((node) => node.status === "DONE");
      const missingRows = nodes.filter((node) => node.status === "AVAILABLE" || node.status === "BLOCKED");
      const rows = [...missingRows, ...doneRows];
      const missingCHT =
        definition.category === "OPTIONAL" ? optionalBucket?.missingCHT ?? missingRows.reduce((sum, node) => sum + node.cht, 0) : missingRows.reduce((sum, node) => sum + node.cht, 0);

      return {
        key: definition.category,
        label: definition.label,
        rows,
        completedCount: doneRows.length,
        missingCount: missingRows.length,
        missingCHT,
        optionsCount: 0,
        usesElectiveCatalog: false
      };
    });
  }, [calculationProgressBuckets, enabledCalculationCategorySet, roadmap]);

  const optionalModuleTables = useMemo(() => {
    if (!roadmap) {
      return [];
    }

    function resolveOptionalModuleKey(node: PrereqNode): (typeof optionalModuleDefinitions)[number]["key"] {
      if (node.category === "TRACK") {
        return "tracks";
      }
      const subcategory = (node.subcategory ?? "").toLowerCase();
      if (subcategory.includes("human")) {
        return "humanities";
      }
      return "second";
    }

    return optionalModuleDefinitions.map((moduleDefinition) => {
      const rows = roadmap.prereqGraph.nodes
        .filter((node) => node.category === "OPTIONAL" || node.category === "TRACK")
        .filter((node) => resolveOptionalModuleKey(node) === moduleDefinition.key)
        .sort((a, b) => (a.recommendedPeriod ?? 99) - (b.recommendedPeriod ?? 99) || a.code.localeCompare(b.code));

      const doneRows = rows.filter((node) => node.status === "DONE");
      const missingRows = rows.filter((node) => node.status === "AVAILABLE" || node.status === "BLOCKED");
      const validatedCHT = doneRows.reduce((sum, node) => sum + node.cht, 0);
      const missingCHT = Math.max(moduleDefinition.requiredCHT - validatedCHT, 0);

      return {
        key: moduleDefinition.key,
        label: moduleDefinition.label,
        requiredCHT: moduleDefinition.requiredCHT,
        validatedCHT,
        missingCHT,
        initiated: validatedCHT > 0,
        rows: [...missingRows, ...doneRows],
        completedCount: doneRows.length,
        missingCount: missingRows.length
      };
    });
  }, [optionalModuleDefinitions, roadmap]);

  const totalMissingCHT = useMemo(() => {
    if (chartProgressBuckets.length === 0) {
      return 0;
    }

    return chartProgressBuckets.reduce((sum, bucket) => sum + bucket.missingCHT, 0);
  }, [chartProgressBuckets]);

  const extensionMissingCHT = useMemo(
    () => chartProgressBuckets.find((bucket) => bucket.key === "extension")?.missingCHT ?? 0,
    [chartProgressBuckets]
  );

  const missingCHTForCHSProjection = useMemo(
    () => chartProgressBuckets.filter((bucket) => bucket.key !== "extension").reduce((sum, bucket) => sum + bucket.missingCHT, 0),
    [chartProgressBuckets]
  );

  const periodRoadmapData = useMemo(() => {
    if (!roadmapForCalculationView) {
      return null;
    }

    const periodIndexes = Array.from({ length: matrixPeriodCount }, (_, idx) => idx + 1);
    const categoryMap = new Map(periodCategoryDefinitions.map((category) => [category.key, category]));

    const periods = periodIndexes.map((periodIndex) => {
      const sectors = new Map(
        periodCategoryDefinitions.map((category) => [
          category.key,
          {
            key: category.key,
            label: category.label,
            color: category.color,
            totalCHT: 0,
            doneCHT: 0,
            missingCHT: 0,
            completionPercent: 0,
            disciplinesTotal: 0,
            disciplinesDone: 0
          }
        ])
      );

      let totalCHT = 0;
      let doneCHT = 0;
      let disciplinesTotal = 0;
      let disciplinesDone = 0;

      for (const node of roadmapForCalculationView.prereqGraph.nodes) {
        if (node.status === "OUTSIDE_SCOPE") {
          continue;
        }
        if (node.recommendedPeriod !== periodIndex) {
          continue;
        }

        const nodeCategory = node.category === "UNKNOWN" ? null : node.category;
        if (!nodeCategory || !categoryMap.has(nodeCategory)) {
          continue;
        }
        const sector = sectors.get(nodeCategory);
        if (!sector) {
          continue;
        }

        sector.totalCHT += node.cht;
        sector.disciplinesTotal += 1;
        totalCHT += node.cht;
        disciplinesTotal += 1;

        if (node.status === "DONE") {
          sector.doneCHT += node.cht;
          sector.disciplinesDone += 1;
          doneCHT += node.cht;
          disciplinesDone += 1;
        }
      }

      const sectorList = [...sectors.values()].map((sector) => {
        const completionPercent = sector.totalCHT > 0 ? (sector.doneCHT / sector.totalCHT) * 100 : 0;
        return {
          ...sector,
          missingCHT: Math.max(sector.totalCHT - sector.doneCHT, 0),
          completionPercent
        };
      });

      return {
        period: periodIndex,
        totalCHT,
        doneCHT,
        missingCHT: Math.max(totalCHT - doneCHT, 0),
        completionPercent: totalCHT > 0 ? (doneCHT / totalCHT) * 100 : 0,
        disciplinesTotal,
        disciplinesDone,
        sectors: sectorList
      };
    });

    const creditPoolRequirements: Array<{ category: CorrelationCategory; requiredCHT: number }> = [
      { category: "OPTIONAL", requiredCHT: optionalNonTrackRequiredCHT },
      { category: "TRACK", requiredCHT: trackRequiredCHT }
    ];

    for (const pool of creditPoolRequirements) {
      const poolNodes = roadmapForCalculationView.prereqGraph.nodes.filter(
        (node) => node.status !== "OUTSIDE_SCOPE" && node.category === pool.category
      );
      if (poolNodes.length === 0) {
        continue;
      }

      const anchorPeriods = poolNodes
        .map((node) => node.recommendedPeriod)
        .filter(
          (period): period is number => typeof period === "number" && Number.isFinite(period) && period >= 1 && period <= matrixPeriodCount
        );
      const anchorPeriod = anchorPeriods.length > 0 ? Math.min(...anchorPeriods) : 1;
      const doneCHT = Math.min(
        poolNodes.reduce((sum, node) => sum + (node.status === "DONE" ? node.cht : 0), 0),
        pool.requiredCHT
      );

      for (const period of periods) {
        const sector = period.sectors.find((item) => item.key === pool.category);
        if (!sector) {
          continue;
        }

        period.totalCHT -= sector.totalCHT;
        period.doneCHT -= sector.doneCHT;
        period.disciplinesTotal -= sector.disciplinesTotal;
        period.disciplinesDone -= sector.disciplinesDone;

        sector.totalCHT = 0;
        sector.doneCHT = 0;
        sector.missingCHT = 0;
        sector.completionPercent = 0;
        sector.disciplinesTotal = 0;
        sector.disciplinesDone = 0;

        if (period.period === anchorPeriod) {
          sector.totalCHT = pool.requiredCHT;
          sector.doneCHT = doneCHT;
          sector.missingCHT = Math.max(sector.totalCHT - sector.doneCHT, 0);
          sector.completionPercent = sector.totalCHT > 0 ? (sector.doneCHT / sector.totalCHT) * 100 : 0;
        }

        period.totalCHT += sector.totalCHT;
        period.doneCHT += sector.doneCHT;
        period.disciplinesTotal += sector.disciplinesTotal;
        period.disciplinesDone += sector.disciplinesDone;
        period.missingCHT = Math.max(period.totalCHT - period.doneCHT, 0);
        period.completionPercent = period.totalCHT > 0 ? (period.doneCHT / period.totalCHT) * 100 : 0;
      }
    }

    const categories = periodCategoryDefinitions.filter((category) =>
      periods.some((period) => period.sectors.some((sector) => sector.key === category.key && sector.totalCHT > 0))
    );

    return { periods, categories };
  }, [matrixPeriodCount, optionalNonTrackRequiredCHT, roadmapForCalculationView, trackRequiredCHT]);

  const plannerPendingDisciplines = useMemo(() => {
    if (!roadmap) {
      return [] as PendingDiscipline[];
    }
    return getPlannerPendingList(roadmap, gradeOptions, selectedPlannerTracks, enabledCalculationCategorySet);
  }, [enabledCalculationCategorySet, gradeOptions, roadmap, selectedPlannerTracks]);

  const pendingTotals = useMemo(() => {
    if (plannerPendingDisciplines.length === 0) {
      return { totalCht: 0, totalEstimatedChs: 0 };
    }

    const totalCht = plannerPendingDisciplines.reduce((sum, item) => sum + item.cht, 0);
    return {
      totalCht,
      totalEstimatedChs: plannerPendingDisciplines.reduce((sum, item) => sum + estimateChsFromCht(item.cht), 0)
    };
  }, [plannerPendingDisciplines]);

  const plannerPendingCount = useMemo(() => {
    return plannerPendingDisciplines.length;
  }, [plannerPendingDisciplines]);

  const manualPlannerData = useMemo(() => {
    if (!roadmap) {
      return null;
    }

    const plannerPending = plannerPendingDisciplines;
    const pendingByCode = new Map(plannerPending.map((discipline) => [discipline.code, discipline]));
    const creditsByCode = new Map((gradeOptions?.availableByDiscipline ?? []).map((discipline) => [discipline.code, discipline.credits]));
    const slots = new Map(
      (gradeOptions?.availableByDiscipline ?? []).map((discipline) => [discipline.code, discipline.turmas[0]])
    );

    const assignedCodes = new Set(Object.values(manualPlan).flat());
    const unassigned = plannerPending.filter((discipline) => !assignedCodes.has(discipline.code));

    const basePeriodCount = Math.max(gradeOptions?.graduationPlan.periods.length ?? 0, matrixPeriodCount, 6);
    const periodIndexes = Array.from({ length: basePeriodCount }, (_, idx) => idx + 1);

    const periods = periodIndexes.map((periodIndex) => {
      const codes = manualPlan[periodIndex] ?? [];
      const disciplines = codes
        .map((code) => pendingByCode.get(code))
        .filter((discipline): discipline is NonNullable<typeof discipline> => Boolean(discipline));

      const totalChs = disciplines.reduce((sum, discipline) => {
        const fromCredits = creditsByCode.get(discipline.code);
        return sum + (typeof fromCredits === "number" && Number.isFinite(fromCredits) ? fromCredits : estimateChsFromCht(discipline.cht));
      }, 0);

      const agenda = disciplines
        .flatMap((discipline) => {
          const turma = slots.get(discipline.code);
          if (!turma) {
            return [];
          }
          return turma.horarios.map((horario) => ({
            code: discipline.code,
            name: discipline.name,
            turma: turma.codigo,
            horario: horario.horario,
            sala: horario.sala
          }));
        })
        .sort((a, b) => a.horario.localeCompare(b.horario));

      return {
        periodIndex,
        disciplines,
        totalChs,
        totalCht: disciplines.reduce((sum, discipline) => sum + discipline.cht, 0),
        agenda
      };
    });

    return { periods, unassigned };
  }, [gradeOptions, manualPlan, matrixPeriodCount, plannerPendingDisciplines, roadmap]);

  const selectedManualPeriod = useMemo(() => {
    if (!manualPlannerData) {
      return null;
    }
    return manualPlannerData.periods.find((period) => period.periodIndex === selectedPlanPeriod) ?? manualPlannerData.periods[0] ?? null;
  }, [manualPlannerData, selectedPlanPeriod]);

  const electiveSummaryBreakdown = useMemo(() => {
    const row = parsedTranscript?.summary.find((item) => item.key.toLowerCase().includes("eletiv"));
    if (!row) {
      return null;
    }

    const taken = Math.max(row.taken ?? 0, 0);
    const validated = Math.max(row.approvedOrValidated ?? 0, 0);
    const missing = Math.max(taken - validated, 0);

    return {
      taken,
      validated,
      missing
    };
  }, [parsedTranscript]);

  const electiveEvidenceAttempts = useMemo(() => {
    if (!parsedTranscript) {
      return [] as ParsedTranscript["attempts"];
    }

    const seen = new Set<string>();
    return parsedTranscript.attempts
      .filter((attempt) => attempt.status === "APPROVED")
      .filter((attempt) => isElectiveLikeAttempt(attempt))
      .filter((attempt) => {
        const code = attempt.code.trim().toUpperCase();
        const key = `${code}-${attempt.year ?? 0}-${attempt.semester ?? 0}-${attempt.classCode ?? ""}-${attempt.cht}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const yearDiff = (b.year ?? 0) - (a.year ?? 0);
        if (yearDiff !== 0) {
          return yearDiff;
        }
        return (b.semester ?? 0) - (a.semester ?? 0);
      });
  }, [parsedTranscript]);

  const electiveRawSnippets = useMemo(() => {
    if (!parsedTranscript?.rawText) {
      return [] as string[];
    }
    return extractRawElectiveSnippets(parsedTranscript.rawText);
  }, [parsedTranscript]);

  const unusedElectiveAggregate = useMemo(() => {
    if (!roadmap) {
      return null;
    }
    return roadmap.unusedDisciplines.find((item) => item.code.toUpperCase() === "ELETIVAS") ?? null;
  }, [roadmap]);

  const unmatchedElectiveAttempts = useMemo(() => {
    if (!roadmap) {
      return [];
    }
    return roadmap.unmatchedApprovedAttempts
      .filter((item) => item.sourceSection === "elective")
      .sort((a, b) => {
        const yearDiff = (b.year ?? 0) - (a.year ?? 0);
        if (yearDiff !== 0) {
          return yearDiff;
        }
        return (b.semester ?? 0) - (a.semester ?? 0);
      });
  }, [roadmap]);

  useEffect(() => {
    const onJson = () => {
      if (!roadmap) {
        return;
      }

      const blob = new Blob([JSON.stringify(roadmap, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "roadmap-academico.json";
      anchor.click();
      URL.revokeObjectURL(url);
    };

    const onPdf = () => {
      void (async () => {
        if (!roadmap || !parsedTranscript) {
          return;
        }

        try {
          setErrorMessage(null);
          const plannerSnapshot =
            manualPlannerData?.periods.map((period) => ({
              periodIndex: period.periodIndex,
              totalChs: period.totalChs,
              totalCht: period.totalCht,
              disciplines: period.disciplines.map((discipline) => ({
                code: discipline.code,
                name: discipline.name,
                cht: discipline.cht,
                estimatedChs: estimateChsFromCht(discipline.cht)
              }))
            })) ?? [];

          const blob = await reportMutation.mutateAsync({ roadmapPayload: roadmap, transcript: parsedTranscript, plannerSnapshot });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = "roadmap-academico.pdf";
          anchor.click();
          URL.revokeObjectURL(url);
        } catch (error) {
          setErrorMessage((error as Error).message);
        }
      })();
    };

    window.addEventListener(ROADMAP_EXPORT_JSON_EVENT, onJson);
    window.addEventListener(ROADMAP_EXPORT_PDF_EVENT, onPdf);

    return () => {
      window.removeEventListener(ROADMAP_EXPORT_JSON_EVENT, onJson);
      window.removeEventListener(ROADMAP_EXPORT_PDF_EVENT, onPdf);
    };
  }, [manualPlannerData, parsedTranscript, reportMutation, roadmap]);

  useEffect(() => {
    const onToggleAssistant = () => {
      if (!roadmap) {
        return;
      }
      setAssistantWidgetOpen((current) => !current);
    };

    window.addEventListener(ROADMAP_ASSISTANT_TOGGLE_EVENT, onToggleAssistant);
    return () => {
      window.removeEventListener(ROADMAP_ASSISTANT_TOGGLE_EVENT, onToggleAssistant);
    };
  }, [roadmap]);

  const chsPaceProjection = useMemo(() => {
    if (!parsedTranscript || !roadmap) {
      return null;
    }

    return buildGraduationForecast({
      parsedTranscript,
      roadmap: roadmapForCalculationView ?? roadmap,
      targetChsPerSemester: maxChsPerPeriod,
      includeCurrentSemesterIfInHistory: true,
      includeInternshipInHistory: enabledCalculationCategorySet.has("INTERNSHIP"),
      missingChtOverride: missingCHTForCHSProjection,
      missingChextOverride: extensionMissingCHT
    });
  }, [
    enabledCalculationCategorySet,
    extensionMissingCHT,
    maxChsPerPeriod,
    missingCHTForCHSProjection,
    parsedTranscript,
    roadmap,
    roadmapForCalculationView
  ]);

  const chsPaceAudit = useMemo<GraduationForecastAudit | null>(() => {
    if (!parsedTranscript || !roadmap) {
      return null;
    }
    return buildGraduationForecastAudit({
      parsedTranscript,
      roadmap: roadmapForCalculationView ?? roadmap
    });
  }, [parsedTranscript, roadmap, roadmapForCalculationView]);

  const dashboardVisualModel = useMemo(() => {
    if (!roadmapForCalculationView) {
      return null;
    }

    return buildDashboardVisualModel({
      roadmap: roadmapForCalculationView,
      parsedTranscript,
      manualPlannerData,
      missingCht: missingCHTForCHSProjection,
      missingChs: missingCHTForCHSProjection > 0 ? estimateChsFromCht(missingCHTForCHSProjection) : 0,
      missingChext: extensionMissingCHT
    });
  }, [extensionMissingCHT, manualPlannerData, missingCHTForCHSProjection, parsedTranscript, roadmapForCalculationView]);

  useEffect(() => {
    if (!dashboardVisualModel?.focusCode) {
      return;
    }

    if (!uiState.focusedSubjectCode) {
      setFocusedSubject(dashboardVisualModel.focusCode);
    }
  }, [dashboardVisualModel?.focusCode, setFocusedSubject, uiState.focusedSubjectCode]);

  useEffect(() => {
    if (!dashboardVisualModel) {
      return;
    }

    const milestoneKey =
      dashboardVisualModel.overallProgressPercent >= 75
        ? "roadmap-achievement-75"
        : dashboardVisualModel.overallProgressPercent >= 50
          ? "roadmap-achievement-50"
          : dashboardVisualModel.overallProgressPercent >= 25
            ? "roadmap-achievement-25"
            : null;

    if (!milestoneKey) {
      return;
    }

    try {
      if (sessionStorage.getItem(milestoneKey)) {
        return;
      }

      sessionStorage.setItem(milestoneKey, "1");
      openAchievementToast();
    } catch {
      // ignore session storage errors
    }
  }, [dashboardVisualModel, openAchievementToast]);

  const chsPaceChartData = useMemo<ChartData<"line"> | null>(() => {
    if (!chsPaceProjection) {
      return null;
    }

    const projectedData = chsPaceProjection.projected.map((value, index) => {
      const historicalValue = chsPaceProjection.historical[index];
      if (typeof value === "number" && typeof historicalValue === "number") {
        return null;
      }
      return value;
    });

    const firstFutureProjectedIndex = projectedData.findIndex((value, index) => {
      if (typeof value !== "number") {
        return false;
      }
      return chsPaceProjection.historical[index] === null;
    });

    if (firstFutureProjectedIndex > 0) {
      const previousHistoricalValue = chsPaceProjection.historical[firstFutureProjectedIndex - 1];
      if (typeof previousHistoricalValue === "number") {
        projectedData[firstFutureProjectedIndex - 1] = previousHistoricalValue;
      }
    }

    return {
      labels: chsPaceProjection.labels,
      datasets: [
        {
          label: "CHS Realizado",
          data: chsPaceProjection.historical,
          borderColor: "#00d26a",
          backgroundColor: "#00d26a",
          tension: 0.25,
          spanGaps: true
        },
        {
          label: "CHS Projetado",
          data: projectedData,
          borderColor: "#39ff14",
          backgroundColor: "#39ff14",
          borderDash: [6, 6],
          tension: 0.25,
          spanGaps: true
        }
      ]
    };
  }, [chsPaceProjection]);

  const busy =
    parseMutation.isPending ||
    calculateMutation.isPending ||
    gradeMutation.isPending ||
    reportMutation.isPending ||
    assistantMutation.isPending;
  const hasMatrixSimulationWarning =
    Boolean(parsedTranscript?.detectedMatrixCode) &&
    isSupportedMatrixCode(parsedTranscript?.detectedMatrixCode ?? null) &&
    Boolean(activeMatrix) &&
    parsedTranscript?.detectedMatrixCode !== activeMatrix;

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-2 py-2 md:px-3 md:py-3">
      <UploadSection visible={isSectionVisible("upload")}>
        <h2 className="text-lg font-bold text-slate-100">1. Upload do Histórico</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-center">
          <input
            accept="application/pdf"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            type="file"
          />

          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm"
            disabled={!parsedTranscript}
            value={activeMatrix}
            onChange={(event) => {
              const value = event.target.value as MatrixCode;
              if (value) {
                void handleRecalculate(value);
              }
            }}
          >
            <option value="">Matriz automática</option>
            {MATRIX_CODE_VALUES.map((matrixCode) => {
              const metadata = getMatrixMetadata(matrixCode);
              return (
                <option key={matrixCode} value={matrixCode}>
                  Matriz {matrixCode} ({metadata.courseAbbreviation})
                </option>
              );
            })}
          </select>

          <button
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!selectedFile || busy}
            onClick={() => void handleParseAndCalculate()}
            type="button"
          >
            {parseMutation.isPending || calculateMutation.isPending ? "Processando..." : "Processar Histórico"}
          </button>
        </div>

        {errorMessage ? <p className="mt-3 text-sm font-semibold text-red-700">{errorMessage}</p> : null}

        {hasMatrixSimulationWarning ? (
          <div className="mt-3 rounded-lg border border-amber-500/70 bg-amber-900/20 p-3 text-xs text-amber-200">
            Simulação de convalidação ativa: histórico detectado na matriz <strong>{parsedTranscript?.detectedMatrixCode}</strong>, mas o
            cálculo atual está na matriz <strong>{activeMatrix}</strong>. O resultado serve para análise de migração/convalidação.
          </div>
        ) : null}

        {showLegacySnapshotWarning && snapshotRestoredFromLocalCache ? (
          <div className="mt-3 rounded-lg border border-amber-500/70 bg-amber-900/20 p-3 text-xs text-amber-200">
            Snapshot local antigo detectado. Os blocos de revisão podem estar desatualizados em relação ao parser atual.
            <div className="mt-2">
              <button
                className="rounded-md border border-amber-300 px-2 py-1 font-semibold text-amber-100 hover:bg-amber-900/40"
                onClick={() => void handleClearSnapshotAndReprocess()}
                type="button"
              >
                Limpar snapshot e reprocessar
              </button>
            </div>
          </div>
        ) : null}

        {parsedTranscript ? (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm">
            <p>
              <strong>Aluno:</strong> {parsedTranscript.student.fullName ?? "-"} ({parsedTranscript.student.registrationId ?? "-"})
            </p>
            <p>
              <strong>Curso:</strong> {parsedTranscript.student.courseCode ?? "-"} - {parsedTranscript.student.courseName ?? "-"}
            </p>
            <p>
              <strong>Matriz detectada:</strong> {parsedTranscript.detectedMatrixCode ?? "não detectada"}
            </p>
            <p>
              <strong>Disciplinas parseadas:</strong> {parsedTranscript.attempts.length} | <strong>Blocos não parseados:</strong>{" "}
              {parsedTranscript.unparsedBlocks.length}
            </p>
          </div>
        ) : null}
      </UploadSection>

      <ReviewSection visible={isSectionVisible("review")}>
        <h2 className="text-lg font-bold text-slate-100">2. Revisão de Parse</h2>
        {!parsedTranscript ? <p className="text-sm text-slate-400">Envie um histórico para habilitar revisão manual.</p> : null}

        {parsedTranscript ? (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Disciplina</th>
                    <th>CHT</th>
                    <th>Média</th>
                    <th>Frequência</th>
                    <th>Status</th>
                    <th>Categoria no cálculo</th>
                    <th>Seção</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedTranscript.attempts.slice(0, 40).map((attempt, index) => (
                    <tr key={`${attempt.code}-${index}`}>
                      {(() => {
                        const normalizedSourceCode = normalizeManualTargetCode(attempt.code);
                        const inferredAutoCategory =
                          reviewAutoCategoryBySourceCode[normalizedSourceCode] ??
                          (attempt.sourceSection === "elective" ? "ELECTIVE" : fallbackCorrelationCategory);
                        const autoCategory = correlationCategoryOptions.includes(inferredAutoCategory as CorrelationCategory)
                          ? (inferredAutoCategory as CorrelationCategory)
                          : fallbackCorrelationCategory;
                        const savedCategory = reviewCategoryBySourceCode[normalizedSourceCode];
                        const selectedCategory = savedCategory && correlationCategoryOptions.includes(savedCategory) ? savedCategory : "";
                        const canOverride = attempt.status === "APPROVED";

                        return (
                          <>
                      <td>{attempt.code}</td>
                      <td>{attempt.name}</td>
                      <td>{attempt.cht}</td>
                      <td>{attempt.average ?? "-"}</td>
                      <td>{attempt.frequency ?? "-"}</td>
                      <td>
                        <StatusPill variant={statusVariant(attempt.status)}>{attempt.status}</StatusPill>
                      </td>
                      <td>
                        {canOverride ? (
                          <div className="space-y-1">
                            <select
                              className="w-full min-w-[180px] rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1.5 text-xs"
                              onChange={(event) =>
                                void handleReviewCategoryOverrideChange(
                                  attempt.code,
                                  (event.target.value || "") as CorrelationCategory | ""
                                )
                              }
                              value={selectedCategory}
                            >
                              <option value="">Automático ({CORRELATION_CATEGORY_LABEL[autoCategory]})</option>
                              {correlationCategoryOptions.map((category) => (
                                <option key={`review-category-${attempt.code}-${category}`} value={category}>
                                  {CORRELATION_CATEGORY_LABEL[category]}
                                </option>
                              ))}
                            </select>
                            <p className="text-[10px] text-slate-500">Auto: {CORRELATION_CATEGORY_LABEL[autoCategory]}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">Somente aprovadas</span>
                        )}
                      </td>
                      <td>{attempt.sourceSection}</td>
                          </>
                        );
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg border border-dashed border-[var(--border)] p-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-400">Blocos não reconhecidos</h3>
              {parsedTranscript.unparsedBlocks.length === 0 ? (
                <p className="mt-2 text-sm text-slate-400">Nenhum bloco não reconhecido.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {parsedTranscript.unparsedBlocks.slice(0, 10).map((block, index) => (
                    <textarea
                      key={`unparsed-${index}`}
                      className="h-24 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-2 text-xs"
                      readOnly
                      value={block}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </ReviewSection>

      <ManualCorrelationSection visible={isSectionVisible("review-manual")}>
        <h2 className="text-lg font-bold text-slate-100">2.1 Correlação Manual de Disciplinas</h2>
        {!roadmap ? (
          <p className="text-sm text-slate-400">Processe o histórico para verificar disciplinas aprovadas não correlacionadas.</p>
        ) : null}

        {roadmap ? (
          <>
            <p className="mt-2 text-sm text-slate-400">
              Se alguma disciplina aprovada ficou fora da sincronização, informe o código da disciplina da matriz para correlacionar.
            </p>

            {roadmap.unmatchedApprovedAttempts.length === 0 ? (
              <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-sm text-emerald-300">
                Nenhuma disciplina aprovada pendente de correlação manual.
              </p>
            ) : (
              <>
                <datalist id="manual-correlation-target-codes">
                  {manualCorrelationTargetOptions.map((item) => (
                    <option key={`manual-target-${item.code}`} value={item.code} label={item.label} />
                  ))}
                </datalist>

                <div className="mt-3 overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Código no histórico</th>
                        <th>Disciplina no histórico</th>
                        <th>CHT</th>
                        <th>Sugestões</th>
                        <th>Correlacionar com (código da matriz)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roadmap.unmatchedApprovedAttempts.map((attempt) => (
                        <tr key={`manual-correlation-${attempt.sourceCode}`}>
                          <td>{attempt.sourceCode}</td>
                          <td>{attempt.sourceName}</td>
                          <td>{attempt.cht}</td>
                          <td>
                            {attempt.suggestedTargets.length === 0 ? (
                              <span className="text-xs text-slate-400">Sem sugestão automática</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {attempt.suggestedTargets.map((suggestion) => (
                                  <span className="pill pill-info" key={`suggestion-${attempt.sourceCode}-${suggestion.code}`}>
                                    {suggestion.code} ({suggestion.strategy})
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            <label className="mb-1 block text-xs font-semibold text-slate-400" htmlFor={`manual-target-${attempt.sourceCode}`}>
                              Escolha o código de destino
                            </label>
                            <input
                              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-sm"
                              id={`manual-target-${attempt.sourceCode}`}
                              list="manual-correlation-target-codes"
                              onChange={(event) =>
                                setManualCorrelations((current) => ({
                                  ...current,
                                  [attempt.sourceCode]: event.target.value
                                }))
                              }
                              placeholder="Ex: GEE73F"
                              value={manualCorrelations[attempt.sourceCode] ?? ""}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-400">
                    Preencha os códigos desejados e clique em aplicar para recalcular o roadmap com a correlação manual.
                  </p>
                  <button
                    className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={calculateMutation.isPending}
                    onClick={() => void handleApplyManualCorrelations()}
                    type="button"
                  >
                    {calculateMutation.isPending ? "Aplicando..." : "Aplicar Correlação Manual"}
                  </button>
                </div>
              </>
            )}
          </>
        ) : null}
      </ManualCorrelationSection>

      <DashboardSection visible={isSectionVisible("dashboard")}>
        <h2 className="text-lg font-bold text-slate-100">3. Dashboard de Progresso</h2>
        {!roadmap ? <p className="text-sm text-slate-400">Roadmap ainda não calculado.</p> : null}

        {roadmap ? (
          <>
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Filtro de categorias nos cálculos</h3>
                  <p className="text-xs text-slate-400">Carga cursada/faltante usa apenas as categorias selecionadas.</p>
                </div>
                <button
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-slate-300 hover:border-[var(--primary)] hover:text-slate-100"
                  onClick={selectAllCalculationCategories}
                  type="button"
                >
                  Selecionar todas
                </button>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {calculationFilterOptions.map((option) => {
                  const selected = enabledCalculationCategorySet.has(option.category);
                  return (
                    <button
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        selected
                          ? "border-[var(--primary)] bg-[rgba(0,210,106,0.18)] text-[var(--text-primary)]"
                          : "border-[var(--border)] bg-[#0b1320] text-slate-300 hover:border-[var(--primary)]"
                      }`}
                      key={`calculation-filter-${option.category}`}
                      onClick={() => toggleCalculationCategory(option.category)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {excludedCalculationCategoryLabels.length > 0 ? (
                <p className="mt-2 text-xs font-semibold text-red-400">
                  Não contabilizado no cálculo atual: {excludedCalculationCategoryLabels.join(", ")}.
                </p>
              ) : null}
            </div>

            {dashboardVisualModel ? (
              <>
                <div className="dashboard-grid-hero mt-4">
                  <CourseAtmosphere model={dashboardVisualModel} />
                  <div className="grid gap-4">
                    <QuickStats model={dashboardVisualModel} />
                    <NextClassWidget model={dashboardVisualModel} />
                  </div>
                </div>
              </>
            ) : null}

            <div className="mt-3 grid gap-3 md:grid-cols-4">
              {chartProgressBuckets.map((bucket) => (
                <MetricCard
                  hint={`Faltante: ${bucket.missingCHT}`}
                  key={bucket.key}
                  subtitle={`de ${bucket.requiredCHT} CHT`}
                  title={bucket.label}
                  value={bucket.validatedCHT}
                />
              ))}
            </div>

            <div className="mt-5 h-72 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              {progressChartData ? <Bar data={progressChartData} options={chartOptions} /> : null}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Gráficos de progresso seguem as categorias selecionadas no filtro.</p>

            <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-100">Ritmo de CHS por Semestre (Histórico + Projeção)</h3>
                {chsPaceProjection ? (
                  <div className="flex flex-col gap-1 text-xs text-slate-400 md:items-end">
                    <p>
                      Média histórica: <strong>{chsPaceProjection.averageChs} CHS/semestre</strong> | Início considerado:{" "}
                      <strong>{chsPaceProjection.startLabel}</strong> | Ritmo de projeção:{" "}
                      <strong>{chsPaceProjection.projectionChs} CHS/semestre</strong> | Faltante estimado:{" "}
                      <strong>{chsPaceProjection.missingChs} CHS</strong>{" "}
                      | Projeção:{" "}
                      <strong>
                        {chsPaceProjection.projectedSemesters} semestre(s)
                        {chsPaceProjection.projectedEndSemester ? ` (até ${chsPaceProjection.projectedEndSemester})` : ""}
                      </strong>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Regra: disciplinas com status <strong>APPROVED</strong> entram no CHS histórico.
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Faltante oficial usado: <strong>{chsPaceProjection.missingCht} CHT</strong>.
                    </p>
                    {chsPaceProjection.missingSource === "roadmap_fallback" ? (
                      <p className="text-[11px] text-amber-400">
                        Resumo oficial do histórico indisponível. A projeção está usando fallback interno do roadmap.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="mt-3 h-72">
                {chsPaceChartData ? (
                  <Line data={chsPaceChartData} options={lineChartOptions} />
                ) : (
                  <p className="text-sm text-slate-400">Dados insuficientes para montar projeção de CHS por semestre.</p>
                )}
              </div>
            </div>

            {chsPaceAudit ? (
              <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                <h3 className="text-sm font-bold text-slate-100">Conferência de Cálculo da Projeção</h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Fonte</th>
                        <th>CHT Faltante</th>
                        <th>CHS Faltante</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Histórico oficial</td>
                        <td>{chsPaceAudit.officialMissingCht ?? "-"}</td>
                        <td>{chsPaceAudit.officialMissingChs ?? "-"}</td>
                      </tr>
                      <tr>
                        <td>Roadmap interno</td>
                        <td>{chsPaceAudit.internalMissingCht}</td>
                        <td>{chsPaceAudit.internalMissingChs}</td>
                      </tr>
                      <tr>
                        <td>Diferença (oficial - interno)</td>
                        <td>{chsPaceAudit.differenceCht ?? "-"}</td>
                        <td>{chsPaceAudit.differenceChs ?? "-"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Extensão faltante considerada: <strong>{chsPaceAudit.missingChext ?? "-"}</strong> CHT.
                </p>
                <p className="mt-1 text-[11px] text-slate-500">{chsPaceAudit.methodologyNote}</p>
              </div>
            ) : null}

            {periodRoadmapData ? (
              <div className="mt-5">
                <p className="mb-2 text-xs text-slate-500">
                  Optativas por período usam carga oficial do PPC: {optionalNonTrackRequiredCHT}h ({optionalNonTrackLabel}) e{" "}
                  {trackRequiredCHT}h ({trackModuleLabel}). O catálogo completo de opções não é somado como carga exigida.
                </p>
                <PeriodRoadmapMegaChart categories={periodRoadmapData.categories} periods={periodRoadmapData.periods} />
              </div>
            ) : null}

            {dashboardVisualModel ? (
                <div className="dashboard-main-grid mt-6">
                  <div className="grid gap-4">
                    <AcademicCalendar />
                    <SmartSuggestions suggestions={dashboardVisualModel.suggestions} />
                  </div>
                </div>
              ) : null}

            <div className="mt-6 space-y-4">
              <h3 className="text-base font-bold text-slate-100">Detalhamento por Setor de Matérias</h3>

              {sectorTables.map((sector) => (
                <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3" key={sector.key}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-slate-100">{sector.label}</h4>
                    {sector.usesElectiveCatalog ? (
                      <p className="text-xs text-slate-400">
                        Concluídas: {sector.completedCount} | Opções disponíveis: {sector.optionsCount} | Horas faltantes:{" "}
                        <strong>{sector.missingCHT} CHT</strong>
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400">
                        Concluídas: {sector.completedCount} | Faltantes: {sector.missingCount} | Horas faltantes:{" "}
                        <strong>{sector.missingCHT} CHT</strong>
                      </p>
                    )}
                  </div>

                  <div className="mt-3 overflow-x-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>Código</th>
                          <th>Disciplina</th>
                          <th>Período</th>
                          <th>CHT</th>
                          <th>Situação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sector.rows.length === 0 ? (
                          <tr>
                            <td colSpan={5}>Sem disciplinas mapeadas nesta categoria.</td>
                          </tr>
                        ) : (
                          sector.rows.map((node) => (
                            <tr key={`${sector.key}-${node.code}`}>
                              <td>{node.code}</td>
                              <td>{node.name}</td>
                              <td>{node.recommendedPeriod ?? "-"}</td>
                              <td>{node.cht}</td>
                              <td>
                                <StatusPill variant={statusVariant(node.status)}>{nodeStatusLabel(node.status)}</StatusPill>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {sector.usesElectiveCatalog ? (
                    <p className="mt-2 text-xs text-slate-400">
                      Selecione quaisquer opções até completar a carga eletiva faltante ({sector.missingCHT} CHT).
                    </p>
                  ) : null}
                </article>
              ))}
            </div>

            {enabledCalculationCategorySet.has("OPTIONAL") || enabledCalculationCategorySet.has("TRACK") ? (
              <div className="mt-6 space-y-4">
                <h3 className="text-base font-bold text-slate-100">
                  Optativas por Submódulo ({optionalPoolBreakdownLabel} = {optionalPoolTotalRequiredCHT}h)
                </h3>

                {optionalModuleTables.map((module) => (
                  <article className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3" key={module.key}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-slate-100">{module.label}</h4>
                      {module.key === "tracks" && !module.initiated ? (
                        <p className="text-xs font-semibold text-amber-700">Trilha não iniciada. Faltam {module.missingCHT} CHT.</p>
                      ) : (
                        <p className="text-xs text-slate-400">
                          Exigido: {module.requiredCHT} CHT | Validado: {module.validatedCHT} CHT | Faltante: {module.missingCHT} CHT
                        </p>
                      )}
                    </div>

                    {module.key === "tracks" && !module.initiated ? null : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="table-base">
                          <thead>
                            <tr>
                              <th>Código</th>
                              <th>Disciplina</th>
                              <th>Período</th>
                              <th>CHT</th>
                              <th>Situação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {module.rows.length === 0 ? (
                              <tr>
                                <td colSpan={5}>Sem disciplinas mapeadas neste submódulo.</td>
                              </tr>
                            ) : (
                              module.rows.map((node) => (
                                <tr key={`${module.key}-${node.code}`}>
                                  <td>{node.code}</td>
                                  <td>{node.name}</td>
                                  <td>{node.recommendedPeriod ?? "-"}</td>
                                  <td>{node.cht}</td>
                                  <td>
                                    <StatusPill variant={statusVariant(node.status)}>{nodeStatusLabel(node.status)}</StatusPill>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : null}

            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              <h3 className="text-base font-bold text-slate-100">Tabela Final de Horas Faltantes</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Setor</th>
                      <th>CHT Exigida</th>
                      <th>CHT Validada</th>
                      <th>CHT Faltante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartProgressBuckets.map((bucket) => (
                      <tr key={`missing-${bucket.key}`}>
                        <td>{bucket.label}</td>
                        <td>{bucket.requiredCHT}</td>
                        <td>{bucket.validatedCHT}</td>
                        <td>{bucket.missingCHT}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>Total faltante</strong>
                      </td>
                      <td>-</td>
                      <td>-</td>
                      <td>
                        <strong>{totalMissingCHT}</strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {dashboardVisualModel ? (
              <div className="mt-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Lista Completa de Matérias</h3>
                    <p className="text-xs text-slate-400">
                      Priorizada para planejamento: pendentes no topo e concluídas ao final.
                    </p>
                  </div>
                  <FocusModeToggle enabled={uiState.focusModeEnabled} onToggle={toggleFocusMode} />
                </div>
                <SubjectRoadmap
                  focusMode={uiState.focusModeEnabled}
                  focusedCode={uiState.focusedSubjectCode}
                  items={dashboardVisualModel.subjects}
                  onFocus={setFocusedSubject}
                />
              </div>
            ) : null}

            {(roadmap.alerts.length > 0 || roadmap.transcriptWarnings.length > 0) && (
              <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
                <p className="font-semibold text-orange-800">Alertas e avisos</p>
                <ul className="mt-2 list-disc pl-6 text-orange-900">
                  {[...roadmap.alerts, ...roadmap.transcriptWarnings].map((warning, index) => (
                    <li key={`warning-${index}`}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : null}
      </DashboardSection>

      <GraphSection visible={isSectionVisible("graph")}>
        <h2 className="text-lg font-bold text-slate-100">4. Grafo de Pré-requisitos</h2>
        {!roadmap ? <p className="text-sm text-slate-400">Faça o processamento para visualizar o grafo.</p> : null}

        {roadmap ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <span className="pill pill-success">Concluídas: {graphStatusSummary.done}</span>
              <span className="pill pill-info">Disponíveis: {graphStatusSummary.available}</span>
              <span className="pill pill-warning">Bloqueadas: {graphStatusSummary.blocked}</span>
              <span className="pill pill-danger">Fora do escopo: {graphStatusSummary.outside}</span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Disciplina</th>
                    <th>Status</th>
                    <th>Pré-requisitos</th>
                    <th>Dependentes</th>
                  </tr>
                </thead>
                <tbody>
                  {roadmap.prereqGraph.nodes
                    .sort((a, b) => (a.recommendedPeriod ?? 99) - (b.recommendedPeriod ?? 99) || a.code.localeCompare(b.code))
                    .map((node) => (
                      <tr key={node.code}>
                        <td>{node.code}</td>
                        <td>{node.name}</td>
                        <td>
                          <StatusPill variant={statusVariant(node.status)}>{node.status}</StatusPill>
                        </td>
                        <td>{node.prerequisites.join(", ") || "-"}</td>
                        <td>{node.dependents.join(", ") || "-"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </GraphSection>

      <PlannerSection visible={isSectionVisible("planner")}>
      <SurfaceCard className="p-5">
        <SectionTitle
          title="5. Planejador de Grade (Drag-and-Drop)"
          subtitle="Arraste disciplinas disponíveis para os períodos e clique no período para ver a agenda."
        />

        {!roadmap ? <p className="mt-2 text-sm text-slate-400">Calcule o roadmap para carregar as pendências.</p> : null}

        {roadmap && activeMatrix ? (
          <>
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Categorias nos cálculos de carga</p>
                <button
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-slate-300 hover:border-[var(--primary)] hover:text-slate-100"
                  onClick={selectAllCalculationCategories}
                  type="button"
                >
                  Selecionar todas
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {calculationFilterOptions.map((option) => {
                  const selected = enabledCalculationCategorySet.has(option.category);
                  return (
                    <button
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        selected
                          ? "border-[var(--primary)] bg-[rgba(0,210,106,0.18)] text-[var(--text-primary)]"
                          : "border-[var(--border)] bg-[#0b1320] text-slate-300 hover:border-[var(--primary)]"
                      }`}
                      key={`planner-calculation-filter-${option.category}`}
                      onClick={() => toggleCalculationCategory(option.category)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {excludedCalculationCategoryLabels.length > 0 ? (
                <p className="mt-2 text-xs font-semibold text-red-400">
                  Não contabilizado no cálculo atual: {excludedCalculationCategoryLabels.join(", ")}.
                </p>
              ) : null}
            </div>

            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              {plannerTrackOptions.length > 0 ? (
                <div className="mb-3 rounded-lg border border-[var(--border)] bg-[#0a1529] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Trilhas consideradas na montagem
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-slate-300 hover:border-[var(--primary)] hover:text-slate-100"
                        onClick={() =>
                          applyPlannerTrackSelection(plannerTrackOptions.filter((item) => item.initiated).map((item) => item.key))
                        }
                        type="button"
                      >
                        Selecionar iniciadas
                      </button>
                      <button
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-slate-300 hover:border-[var(--primary)] hover:text-slate-100"
                        onClick={() => applyPlannerTrackSelection(plannerTrackOptions.map((item) => item.key))}
                        type="button"
                      >
                        Selecionar todas
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {plannerTrackOptions.map((track) => {
                      const selected = selectedPlannerTracks.includes(track.key);
                      return (
                        <button
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            selected
                              ? "border-[var(--primary)] bg-[rgba(0,210,106,0.18)] text-[var(--text-primary)]"
                              : "border-[var(--border)] bg-[#0b1320] text-slate-300 hover:border-[var(--primary)]"
                          }`}
                          key={`planner-track-${track.key}`}
                          onClick={() => togglePlannerTrack(track.key)}
                          type="button"
                        >
                          {track.label} ({track.doneNodes}/{track.totalNodes} feitas • {track.pendingAvailable}/{track.pendingTotal} pend.)
                        </button>
                      );
                    })}
                  </div>

                  <p className="mt-2 text-xs text-slate-400">
                    A IA e o botão de geração usam apenas as trilhas selecionadas. Você pode ajustar manualmente os cards depois.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-[220px_1fr_auto] md:items-end">
                <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  CHS alvo por período
                  <input
                    className="rounded-lg border border-[var(--border)] bg-[#0b1320] px-3 py-2 text-sm text-slate-100"
                    max={40}
                    min={1}
                    onChange={(event) => setMaxChsPerPeriod(Math.max(1, Math.min(40, Number(event.target.value) || 1)))}
                    type="number"
                    value={maxChsPerPeriod}
                  />
                </label>

                <div className="text-sm text-slate-300">
                  <p>
                    Pendências consideradas no plano: <strong>{plannerPendingCount} disciplinas</strong>
                  </p>
                  <p>
                    Carga pendente estimada: <strong>{pendingTotals.totalEstimatedChs} CHS</strong> ({pendingTotals.totalCht} CHT)
                  </p>
                  <p className="text-xs text-slate-400">
                    Categorias ativas no cálculo:{" "}
                    <strong>
                      {calculationFilterOptions.filter((option) => enabledCalculationCategorySet.has(option.category))
                        .map((option) => option.label)
                        .join(", ") || "nenhuma"}
                    </strong>
                  </p>
                  {selectedPlannerTrackLabels.length > 0 ? (
                    <p className="text-xs text-slate-400">
                      Trilhas ativas: <strong>{selectedPlannerTrackLabels.join(", ")}</strong>
                    </p>
                  ) : null}
                </div>

                <button
                  className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={gradeMutation.isPending || plannerPendingCount === 0}
                  onClick={() => void handleLoadGrade()}
                  type="button"
                >
                  {gradeMutation.isPending ? "Gerando plano..." : "Gerar Plano de Formatura"}
                </button>
              </div>
            </div>

            {gradeOptions && manualPlannerData ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <MetricCard title="Semestre Base" value={gradeOptions.semesterUsed} subtitle={`Atualizado em ${gradeOptions.lastUpdate}`} />
                  <MetricCard title="Períodos no Plano" value={manualPlannerData.periods.length} subtitle={`Meta ${maxChsPerPeriod} CHS`} />
                  <MetricCard title="Pendências sem período" value={manualPlannerData.unassigned.length} subtitle="Cards na coluna de origem" />
                  <MetricCard
                    title="Período Selecionado"
                    value={selectedManualPeriod ? `#${selectedManualPeriod.periodIndex}` : "-"}
                    subtitle={selectedManualPeriod ? `${selectedManualPeriod.totalChs} CHS` : "Selecione um período"}
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(250px,0.8fr)_1.2fr]">
                  <div
                    className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-soft)] p-3"
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const code = event.dataTransfer.getData("text/plain");
                      if (code) {
                        moveCodeToPeriod(code, null);
                      }
                    }}
                  >
                    <h3 className="text-sm font-bold text-slate-100">Disciplinas Disponíveis</h3>
                    <p className="mt-1 text-xs text-slate-400">Arraste os cards para os períodos desejados.</p>
                    <div className="mt-3 space-y-2">
                      {manualPlannerData.unassigned.length === 0 ? (
                        <p className="text-sm text-slate-400">Todas as pendências já estão alocadas em algum período.</p>
                      ) : (
                        manualPlannerData.unassigned.map((discipline) => (
                          <DisciplineDragCard
                            chs={estimateChsFromCht(discipline.cht)}
                            cht={discipline.cht}
                            code={discipline.code}
                            key={`unassigned-${discipline.code}`}
                            name={discipline.name}
                            draggable
                          />
                        ))
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {manualPlannerData.periods.map((period) => (
                      <PeriodDropLane
                        key={`lane-${period.periodIndex}`}
                        onDropCode={(code) => moveCodeToPeriod(code, period.periodIndex)}
                        onSelect={() => setSelectedPlanPeriod(period.periodIndex)}
                        selected={selectedManualPeriod?.periodIndex === period.periodIndex}
                        subtitle={`${period.totalChs} CHS · ${period.totalCht} CHT`}
                        title={`Período ${period.periodIndex}`}
                      >
                        {period.disciplines.length === 0 ? (
                          <p className="text-xs text-slate-400">Arraste disciplinas para este período.</p>
                        ) : (
                          period.disciplines.map((discipline) => (
                            <DisciplineDragCard
                              chs={estimateChsFromCht(discipline.cht)}
                              cht={discipline.cht}
                              code={discipline.code}
                              compact
                              key={`lane-card-${period.periodIndex}-${discipline.code}`}
                              name={discipline.name}
                              onRemove={(code) => moveCodeToPeriod(code, null)}
                              draggable
                            />
                          ))
                        )}
                      </PeriodDropLane>
                    ))}
                  </div>
                </div>

                {selectedManualPeriod ? (
                  <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                      <h3 className="text-sm font-bold text-slate-100">Resumo do Período {selectedManualPeriod.periodIndex}</h3>
                      <div className="mt-3 overflow-x-auto">
                        <table className="table-base">
                          <thead>
                            <tr>
                              <th>Código</th>
                              <th>Disciplina</th>
                              <th>CHS</th>
                              <th>CHT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedManualPeriod.disciplines.map((discipline) => (
                              <tr key={`selected-period-${selectedManualPeriod.periodIndex}-${discipline.code}`}>
                                <td>{discipline.code}</td>
                                <td>{discipline.name}</td>
                                <td>{estimateChsFromCht(discipline.cht)}</td>
                                <td>{discipline.cht}</td>
                              </tr>
                            ))}
                            {selectedManualPeriod.disciplines.length === 0 ? (
                              <tr>
                                <td colSpan={4}>Sem disciplinas neste período.</td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                      <h3 className="text-sm font-bold text-slate-100">Agenda do Período {selectedManualPeriod.periodIndex}</h3>
                      <div className="mt-3">
                        <WeeklyAgendaBoard entries={selectedManualPeriod.agenda} />
                      </div>

                      <div className="mt-4 overflow-x-auto">
                        <table className="table-base">
                          <thead>
                            <tr>
                              <th>Dia</th>
                              <th>Turno</th>
                              <th>Horário</th>
                              <th>Disciplina</th>
                              <th>Turma</th>
                              <th>Sala</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedManualPeriod.agenda.map((entry, index) => {
                              const pretty = prettyHorario(entry.horario);
                              return (
                                <tr key={`manual-agenda-${index}`}>
                                  <td>{pretty.day}</td>
                                  <td>{pretty.shift}</td>
                                  <td>{entry.horario}</td>
                                  <td>
                                    {entry.code} - {entry.name}
                                  </td>
                                  <td>{entry.turma}</td>
                                  <td>{entry.sala}</td>
                                </tr>
                              );
                            })}
                            {selectedManualPeriod.agenda.length === 0 ? (
                              <tr>
                                <td colSpan={6}>Sem horários encontrados para as disciplinas deste período.</td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                  <h3 className="text-sm font-bold text-slate-100">Oferta GradeNaHora (auditoria)</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>Código</th>
                          <th>Disciplina</th>
                          <th>CHS</th>
                          <th>Turmas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gradeOptions.availableByDiscipline.map((item) => (
                          <tr key={`offer-${item.code}`}>
                            <td>{item.code}</td>
                            <td>{item.name}</td>
                            <td>{item.credits ?? "-"}</td>
                            <td>{item.turmas.map((turma) => turma.codigo).join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {gradeOptions.warnings.length > 0 ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                    <p className="font-semibold">Avisos da integração</p>
                    <ul className="mt-2 list-disc pl-6">
                      {gradeOptions.warnings.slice(0, 8).map((warning, index) => (
                        <li key={`grade-warning-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </SurfaceCard>
      </PlannerSection>

      {roadmap && assistantWidgetOpen ? (
        <div className="fixed right-3 top-24 z-[95] w-[min(420px,calc(100vw-1.5rem))] xl:right-8 xl:top-24">
          <section className="rounded-2xl border border-[var(--border)] bg-[#071326] shadow-2xl shadow-black/50">
            <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100">Assistente de Grade</h3>
                <p className="text-[11px] text-slate-400">Gera propostas de grade e aplica somente quando você escolher.</p>
              </div>
              <button
                className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-slate-300 hover:bg-[#0f2038]"
                onClick={() => setAssistantWidgetOpen(false)}
                type="button"
              >
                fechar
              </button>
            </header>

            <div className="max-h-[360px] space-y-2 overflow-y-auto px-4 py-3">
              {assistantMessages.map((message) => (
                <article
                  className={`rounded-xl border p-2.5 ${
                    message.role === "assistant" ? "border-[var(--border)] bg-[#0c1525]" : "border-[#334b74] bg-[#13203a]"
                  }`}
                  key={message.id}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {message.role === "assistant" ? "Assistente" : "Você"}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-100">{message.text}</p>
                  {message.action === "ASK_PERIOD" && message.question?.kind === "PERIOD" ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.question.periodOptions.map((periodIndex) => (
                        <button
                          className="rounded-md border border-[#2f466d] bg-[#11213a] px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-[#163058]"
                          key={`assistant-period-option-${message.id}-${periodIndex}`}
                          onClick={() => void handleAssistantPeriodReply(periodIndex, message.id)}
                          type="button"
                        >
                          Período {periodIndex}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {message.action === "SHOW_PROPOSALS" && message.proposals && message.proposals.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {message.proposals.map((proposal, index) => (
                        <div
                          className="rounded-lg border border-[#2f466d] bg-[#0f2038] p-2"
                          key={`assistant-proposal-${message.id}-${proposal.id}`}
                        >
                          <p className="text-xs font-semibold text-emerald-300">
                            Opção {index + 1}: {proposal.achievedChs} CHS • {proposal.subjectsCount} matéria(s)
                          </p>
                          <p className="mt-1 text-[11px] text-slate-200">
                            {proposal.classes
                              .map((item) => {
                                const horarios = item.horarios.map((slot) => slot.horario).join(", ");
                                return `${item.code}-${item.classCode} [${horarios}]`;
                              })
                              .join(" • ")}
                          </p>
                          {proposal.constraintReport.relaxed.length > 0 ? (
                            <p className="mt-1 text-[10px] text-amber-300">{proposal.constraintReport.relaxed.join(" ")}</p>
                          ) : null}
                          <button
                            className="mt-2 rounded-md bg-[var(--primary)] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90"
                            onClick={() => applyAssistantProposal(proposal)}
                            type="button"
                          >
                            Aplicar proposta
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {message.planPatch ? (
                    <p className="mt-2 text-[11px] text-emerald-300">
                      Proposta legada: período {message.planPatch.periodIndex} com {message.planPatch.achievedChs} CHS.
                    </p>
                  ) : null}
                </article>
              ))}
            </div>

            <div className="space-y-2 border-t border-[var(--border)] px-4 py-3">
              <textarea
                className="h-20 w-full rounded-lg border border-[var(--border)] bg-[#0b1320] p-2.5 text-sm text-slate-100"
                onChange={(event) => setAssistantInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void handleAssistantSend();
                  }
                }}
                placeholder="Ex: monte minha grade no período 3 com foco em fim de tarde/noite."
                value={assistantInput}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-slate-500">Cmd/Ctrl + Enter para enviar</p>
                <button
                  className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  disabled={assistantMutation.isPending}
                  onClick={() => void handleAssistantSend()}
                  type="button"
                >
                  {assistantMutation.isPending ? "Pensando..." : "Enviar"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <UnusedSection visible={isSectionVisible("unused")}>
        <h2 className="text-lg font-bold text-slate-100">6. Disciplinas Não Utilizadas</h2>
        {!roadmap ? <p className="text-sm text-slate-400">Sem dados para exibir.</p> : null}

        {roadmap ? (
          <div className="mt-3 space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
              <h3 className="text-sm font-bold text-slate-100">Convalidar Disciplina Não Utilizada</h3>
              <p className="mt-1 text-xs text-slate-400">
                Selecione uma disciplina da lista e informe a disciplina de destino na matriz ativa. O lookup busca por código e nome e
                mostra curso abreviado + matriz de cada opção. Após aplicar, a disciplina sai de “Não Utilizadas”.
              </p>

              <datalist id="unused-convalidation-target-lookup">
                {unusedConvalidationTargetOptions.map((item) => (
                  <option
                    key={`unused-target-${item.key}`}
                    label={`${item.name} | ${item.code} | ${item.courseAbbr} | Matriz ${item.matrixCode} | ${item.categoryLabel}`}
                    value={item.lookupValue}
                  />
                ))}
              </datalist>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">
                  A convalidação agora é feita diretamente na tabela abaixo: cada linha tem sugestão, lookup e botão próprio.
                  {globalDisciplineLookupOptions.length > 0
                    ? ` Lookup global carregado com todas as matérias cadastradas (matrizes ${SUPPORTED_MATRICES_LABEL}).`
                    : " Lookup global indisponível no momento; exibindo fallback da matriz ativa."}
                </p>
                <button
                  className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={calculateMutation.isPending || unusedConvalidationSourceOptions.length === 0}
                  onClick={() => void handleConvalidateAllUnused()}
                  type="button"
                >
                  {calculateMutation.isPending ? "Convalidando..." : "Convalidar Todas as Correspondências"}
                </button>
              </div>
              {unusedConvalidationNotice ? <p className="mt-2 text-xs font-semibold text-emerald-300">{unusedConvalidationNotice}</p> : null}
              {unusedConvalidationError ? <p className="mt-2 text-xs font-semibold text-rose-300">{unusedConvalidationError}</p> : null}
            </div>

            {unusedElectiveAggregate || electiveSummaryBreakdown ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
                <h3 className="text-sm font-bold text-slate-100">Transparência da Carga Eletiva Não Validada</h3>
                <p className="mt-1 text-xs text-slate-300">
                  {electiveSummaryBreakdown
                    ? `${electiveSummaryBreakdown.taken} CHT = eletivas cursadas no histórico; ${electiveSummaryBreakdown.validated} CHT = eletivas validadas; saldo sem validação = ${electiveSummaryBreakdown.missing} CHT.`
                    : "Não foi possível montar o detalhamento de eletivas a partir do resumo do histórico."}
                </p>
                {unusedElectiveAggregate ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Valor exibido em “Disciplinas Não Utilizadas” para ELETIVAS: <strong>{unusedElectiveAggregate.cht} CHT</strong>.
                  </p>
                ) : null}

                <div className="mt-3 overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Disciplina no Histórico</th>
                        <th>CHT</th>
                        <th>Ano/Semestre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {electiveEvidenceAttempts.length === 0 ? (
                        <tr>
                          <td colSpan={4}>
                            O parser não conseguiu identificar individualmente as eletivas aprovadas que compõem essa carga.
                          </td>
                        </tr>
                      ) : (
                        electiveEvidenceAttempts.map((attempt, index) => (
                          <tr key={`unused-evidence-${attempt.code}-${attempt.year ?? 0}-${attempt.semester ?? 0}-${index}`}>
                            <td>{attempt.code}</td>
                            <td>{attempt.name || attempt.code}</td>
                            <td>{attempt.cht}</td>
                            <td>{formatYearSemester(attempt.year, attempt.semester)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {electiveEvidenceAttempts.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-[#0b1320] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      Texto bruto do histórico (sem parse)
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Trechos extraídos diretamente do PDF para auditoria manual da carga eletiva.
                    </p>
                    {electiveRawSnippets.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Não encontrei linhas contendo “eletiva/optativa” no texto bruto extraído.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {electiveRawSnippets.map((snippet, index) => (
                          <li
                            className="rounded border border-[var(--border)] bg-[#09101b] px-2 py-1.5 text-xs text-slate-300"
                            key={`raw-elective-snippet-${index}`}
                          >
                            {snippet}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}

                {unmatchedElectiveAttempts.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>Disciplina aprovada sem correlação</th>
                          <th>CHT</th>
                          <th>Ano/Semestre</th>
                          <th>Sugestões de correlação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unmatchedElectiveAttempts.slice(0, 12).map((item) => (
                          <tr key={`unused-unmatched-${item.sourceCode}-${item.year ?? 0}-${item.semester ?? 0}`}>
                            <td>
                              {item.sourceCode} - {item.sourceName}
                            </td>
                            <td>{item.cht}</td>
                            <td>{formatYearSemester(item.year, item.semester)}</td>
                            <td>
                              {item.suggestedTargets.length > 0
                                ? item.suggestedTargets.map((target) => `${target.code} (${target.strategy})`).join(", ")
                                : "Sem sugestão automática"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Disciplina</th>
                    <th>CHT</th>
                    <th>Matérias relacionadas</th>
                    <th>Correspondência sugerida</th>
                    <th>Categoria para convalidar</th>
                    <th>CHT a convalidar</th>
                    <th>Destino (lookup) ou criação manual</th>
                    <th>Motivo</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {roadmap.unusedDisciplines.length === 0 ? (
                    <tr>
                      <td colSpan={10}>Nenhuma disciplina não utilizada.</td>
                    </tr>
                  ) : (
                    roadmap.unusedDisciplines.map((item, index) => (
                      <tr key={`${item.code}-${index}`}>
                        <td>{item.code}</td>
                        <td>{item.name}</td>
                        <td>{item.cht}</td>
                        <td>{item.relatedSubjects?.join(", ") || `${item.code} - ${item.name}`}</td>
                        <td>
                          {item.code.toUpperCase() === "ELETIVAS" ? (
                            <span className="text-xs text-slate-500">-</span>
                          ) : unusedAutomaticSuggestionBySource[item.code] ? (
                            <span className="text-xs text-emerald-300">
                              {unusedAutomaticSuggestionBySource[item.code]?.code} - {unusedAutomaticSuggestionBySource[item.code]?.name}
                            </span>
                          ) : (
                            <span className="text-xs text-amber-300">Sem match único automático</span>
                          )}
                        </td>
                        <td>
                          {item.code.toUpperCase() === "ELETIVAS" ? (
                            <span className="text-xs text-slate-500">-</span>
                          ) : (
                            <select
                              className="w-full min-w-[140px] rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1.5 text-xs"
                              onChange={(event) =>
                                setUnusedInlineCategoryBySource((current) => ({
                                  ...current,
                                  [item.code]: event.target.value as CorrelationCategory
                                }))
                              }
                              value={
                                unusedInlineCategoryBySource[item.code] ??
                                (unusedAutomaticSuggestionBySource[item.code]?.category ?? fallbackCorrelationCategory)
                              }
                            >
                              {correlationCategoryOptions.map((category) => (
                                <option key={`unused-cat-${item.code}-${category}`} value={category}>
                                  {CORRELATION_CATEGORY_LABEL[category]}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td>
                          {item.code.toUpperCase() === "ELETIVAS" ? (
                            <span className="text-xs text-slate-500">-</span>
                          ) : (
                            <input
                              className="w-full min-w-[90px] rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1.5 text-xs"
                              inputMode="numeric"
                              min={1}
                              onChange={(event) =>
                                setUnusedInlineChtBySource((current) => ({
                                  ...current,
                                  [item.code]: event.target.value
                                }))
                              }
                              placeholder="CHT"
                              step={1}
                              type="number"
                              value={unusedInlineChtBySource[item.code] ?? String(item.cht)}
                            />
                          )}
                        </td>
                        <td>
                          {item.code.toUpperCase() === "ELETIVAS" ? (
                            <span className="text-xs text-slate-500">Convalidar no bloco de eletivas</span>
                          ) : (
                            <div className="space-y-1">
                              <label className="flex items-center gap-2 text-[11px] text-slate-300">
                                <input
                                  checked={Boolean(unusedInlineManualOnlyBySource[item.code])}
                                  onChange={(event) =>
                                    setUnusedInlineManualOnlyBySource((current) => ({
                                      ...current,
                                      [item.code]: event.target.checked
                                    }))
                                  }
                                  type="checkbox"
                                />
                                Criar manualmente (sem código da matriz)
                              </label>

                              {!unusedInlineManualOnlyBySource[item.code] ? (
                                <input
                                  className="w-full min-w-[320px] rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1.5 text-xs"
                                  list="unused-convalidation-target-lookup"
                                  onChange={(event) =>
                                    setUnusedInlineTargetBySource((current) => ({
                                      ...current,
                                      [item.code]: event.target.value
                                    }))
                                  }
                                  placeholder="Digite código/nome e selecione no lookup"
                                  value={unusedInlineTargetBySource[item.code] ?? ""}
                                />
                              ) : (
                                <div className="grid gap-1 sm:grid-cols-2">
                                  <input
                                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1.5 text-xs"
                                    onChange={(event) =>
                                      setUnusedInlineManualNameBySource((current) => ({
                                        ...current,
                                        [item.code]: event.target.value
                                      }))
                                    }
                                    placeholder="Nome manual da disciplina"
                                    value={unusedInlineManualNameBySource[item.code] ?? item.name}
                                  />
                                  <input
                                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-1.5 text-xs"
                                    onChange={(event) =>
                                      setUnusedInlineManualCodeBySource((current) => ({
                                        ...current,
                                        [item.code]: event.target.value.toUpperCase()
                                      }))
                                    }
                                    placeholder="Código manual (opcional)"
                                    value={unusedInlineManualCodeBySource[item.code] ?? ""}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td>{item.reason}</td>
                        <td>
                          {item.code.toUpperCase() === "ELETIVAS" ? (
                            <span className="text-xs text-slate-500">Convalidar no bloco de eletivas</span>
                          ) : (
                            <div className="flex min-w-[110px] flex-col gap-1">
                              <button
                                className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-slate-200 hover:bg-[var(--surface-soft)]"
                                onClick={() => {
                                  const suggestion = unusedAutomaticSuggestionBySource[item.code];
                                  if (suggestion) {
                                    setUnusedInlineManualOnlyBySource((current) => ({
                                      ...current,
                                      [item.code]: false
                                    }));
                                    setUnusedInlineTargetBySource((current) => ({
                                      ...current,
                                      [item.code]: suggestion.lookupValue
                                    }));
                                    setUnusedInlineCategoryBySource((current) => ({
                                      ...current,
                                      [item.code]: suggestion.category
                                    }));
                                  }
                                }}
                                type="button"
                              >
                                Sugerir
                              </button>
                              <button
                                className="rounded-md bg-[var(--primary)] px-2 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                                disabled={calculateMutation.isPending}
                                onClick={() => void handleConvalidateUnusedRow(item.code)}
                                type="button"
                              >
                                Convalidar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </UnusedSection>

      <AchievementToast
        description={
          dashboardVisualModel
            ? `${dashboardVisualModel.completedSubjects} disciplinas concluídas até agora.`
            : "Continue avançando no seu plano."
        }
        onClose={closeAchievementToast}
        open={uiState.achievementToastOpen}
        title="Mini-meta concluída"
      />
    </main>
  );
}
