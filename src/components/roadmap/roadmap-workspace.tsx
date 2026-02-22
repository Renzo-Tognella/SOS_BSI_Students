"use client";

import { useEffect, useMemo, useState } from "react";
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
  AssistantPlanPatch,
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
  estimateChsFromCht,
  FORECAST_METHODOLOGY_NOTE
} from "@/lib/domain/graduation-forecast";

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

const optionalModuleDefinitions = [
  { key: "second", label: "Segundo Estrato", requiredCHT: 360 },
  { key: "tracks", label: "Terceiro Estrato - Trilhas em Computação", requiredCHT: 345 },
  { key: "humanities", label: "Optativas do Ciclo de Humanidades", requiredCHT: 135 }
] as const;

const periodCategoryDefinitions = [
  { key: "MANDATORY", label: "Obrigatórias", color: "#6a7cff" },
  { key: "OPTIONAL", label: "Optativas", color: "#22d3ee" },
  { key: "TRACK", label: "Trilhas", color: "#4ad89d" },
  { key: "ELECTIVE", label: "Eletivas", color: "#f59e0b" },
  { key: "COMPLEMENTARY", label: "Complementares", color: "#a78bfa" },
  { key: "INTERNSHIP", label: "Estágio", color: "#f472b6" },
  { key: "TCC", label: "TCC", color: "#facc15" },
  { key: "UNKNOWN", label: "Outras", color: "#94a3b8" }
] as const;

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

function ensureRoadmapShape(roadmap: RoadmapResult): RoadmapResult {
  return {
    ...roadmap,
    unmatchedApprovedAttempts: roadmap.unmatchedApprovedAttempts ?? [],
    electiveOptions: roadmap.electiveOptions ?? []
  };
}

const SYNTHETIC_ELECTIVE_PENDING_PATTERN = /^ELVP\d{3}C\d{3}$/i;

function isSyntheticElectivePendingCode(code: string): boolean {
  return SYNTHETIC_ELECTIVE_PENDING_PATTERN.test(code.trim().toUpperCase());
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

function getPlannerPendingList(roadmap: RoadmapResult, gradeOptions?: GradeOptionsResponse | null): PendingDiscipline[] {
  const syntheticPendings = roadmap.pending.filter((item) => isSyntheticElectivePendingCode(item.code));
  if (syntheticPendings.length === 0) {
    return roadmap.pending
      .map((item) => normalizePlannerPendingWithoutChext(item))
      .filter((item): item is PendingDiscipline => Boolean(item));
  }

  const nonSynthetic = roadmap.pending.filter((item) => !isSyntheticElectivePendingCode(item.code));
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
    return roadmap.pending;
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

export type RoadmapSectionKey = "upload" | "review" | "dashboard" | "graph" | "planner" | "unused";

interface RoadmapWorkspaceProps {
  currentSection: RoadmapSectionKey;
}

interface AssistantMessage {
  id: string;
  role: "assistant" | "user";
  text: string;
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
  const [selectedPlanPeriod, setSelectedPlanPeriod] = useState<number>(1);
  const [manualPlan, setManualPlan] = useState<Record<number, string[]>>({});
  const [manualCorrelations, setManualCorrelations] = useState<Record<string, string>>({});
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantWidgetOpen, setAssistantWidgetOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      text:
        "Sou seu assistente de planejamento. Posso montar sua grade com restrições de horário, estimar quando você se forma por CHS e sugerir disciplinas da trilha de IA.",
      createdAt: new Date().toISOString()
    }
  ]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { uiState, toggleFocusMode, setFocusedSubject, openAchievementToast, closeAchievementToast } =
    useRoadmapWorkspaceState();

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
        selectedPlanPeriod?: number;
        manualPlan?: Record<number, string[]>;
        manualCorrelations?: Record<string, string>;
        assistantMessages?: AssistantMessage[];
      };

      if (saved.parsedTranscript) setParsedTranscript(saved.parsedTranscript);
      if (saved.roadmap) setRoadmap(ensureRoadmapShape(saved.roadmap));
      if (saved.gradeOptions) setGradeOptions(saved.gradeOptions);
      if (saved.activeMatrix) setActiveMatrix(saved.activeMatrix);
      if (typeof saved.maxChsPerPeriod === "number" && Number.isFinite(saved.maxChsPerPeriod)) {
        setMaxChsPerPeriod(saved.maxChsPerPeriod);
      }
      if (typeof saved.selectedPlanPeriod === "number" && Number.isFinite(saved.selectedPlanPeriod)) {
        setSelectedPlanPeriod(saved.selectedPlanPeriod);
      }
      if (saved.manualPlan) setManualPlan(saved.manualPlan);
      if (saved.manualCorrelations) setManualCorrelations(saved.manualCorrelations);
      if (saved.assistantMessages && saved.assistantMessages.length > 0) {
        setAssistantMessages(saved.assistantMessages);
      }
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
      selectedPlanPeriod,
      manualPlan,
      manualCorrelations,
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
    selectedPlanPeriod,
    manualPlan,
    manualCorrelations,
    assistantMessages
  ]);

  const isSectionVisible = (section: RoadmapSectionKey | "review-manual"): boolean => {
    if (section === "review-manual") {
      return currentSection === "review";
    }
    return currentSection === section;
  };

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
        course: parsedTranscript?.student.courseCode ?? "236",
        campus: "01",
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
          selectedPeriodIndex: selectedPlanPeriod,
          maxChsPerPeriod
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Falha ao consultar assistente."));
      }

      return (await response.json()) as AssistantChatResponse;
    }
  });

  async function runCalculation(
    transcript: ParsedTranscript,
    matrixCode?: MatrixCode,
    manualMappings?: ManualCorrelationInput[]
  ): Promise<void> {
    const roadmapResult = await calculateMutation.mutateAsync({ transcript, matrixCode, manualMappings });
    setRoadmap(roadmapResult);
  }

  async function handleParseAndCalculate(): Promise<void> {
    if (!selectedFile) {
      setErrorMessage("Selecione um arquivo PDF antes de enviar.");
      return;
    }

    try {
      setErrorMessage(null);
      setGradeOptions(null);
      const parsed = await parseMutation.mutateAsync(selectedFile);
      setParsedTranscript(parsed);
      setManualCorrelations({});

      const matrix = parsed.detectedMatrixCode ?? "981";
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
      await runCalculation(parsedTranscript, matrixCode, Object.entries(manualCorrelations).flatMap(([sourceCode, targetCode]) => {
        const normalizedTargetCode = normalizeManualTargetCode(targetCode);
        if (!normalizedTargetCode) {
          return [];
        }
        return [{ sourceCode, targetCode: normalizedTargetCode }];
      }));
      setGradeOptions(null);
    } catch (error) {
      setErrorMessage((error as Error).message);
    }
  }

  async function handleApplyManualCorrelations(): Promise<void> {
    if (!parsedTranscript || !activeMatrix) {
      return;
    }

    const mappings: ManualCorrelationInput[] = Object.entries(manualCorrelations).flatMap(([sourceCode, targetCode]) => {
      const normalizedTargetCode = normalizeManualTargetCode(targetCode);
      if (!normalizedTargetCode) {
        return [];
      }
      return [{ sourceCode, targetCode: normalizedTargetCode }];
    });

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

  async function handleLoadGrade(): Promise<void> {
    if (!roadmap || !activeMatrix) {
      return;
    }

    try {
      setErrorMessage(null);
      const pendingCodes = getPlannerPendingList(roadmap, gradeOptions).map((item) => item.code);
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

  async function handleAssistantSend(): Promise<void> {
    const content = assistantInput.trim();
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
        planPatch: result.planPatch,
        providerUsed: result.providerUsed,
        diagnostics: result.diagnostics,
        createdAt: new Date().toISOString()
      });
      if (result.planPatch) {
        applyAssistantPlanPatch(result.planPatch);
      }
    } catch (error) {
      appendAssistantMessage({
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        text: `Erro ao processar sua solicitação: ${(error as Error).message}`,
        createdAt: new Date().toISOString()
      });
    }
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

  const progressChartData = useMemo<ChartData<"bar"> | null>(() => {
    if (!roadmap) {
      return null;
    }

    const chartBuckets = roadmap.progress.filter((item) => item.key !== "extension");

    return {
      labels: chartBuckets.map((item) => item.label),
      datasets: [
        {
          label: "CHT Validada",
          data: chartBuckets.map((item) => item.validatedCHT),
          backgroundColor: "rgba(0, 210, 106, 0.75)"
        },
        {
          label: "CHT Faltante",
          data: chartBuckets.map((item) => item.missingCHT),
          backgroundColor: "rgba(255, 184, 0, 0.72)"
        }
      ]
    };
  }, [roadmap]);

  const chartProgressBuckets = useMemo(() => {
    if (!roadmap) {
      return [];
    }
    return roadmap.progress.filter((bucket) => bucket.key !== "extension");
  }, [roadmap]);

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

  const manualCorrelationTargetOptions = useMemo(() => {
    if (!roadmap) {
      return [];
    }

    const syntheticPattern = /^ELV[PD]\d{3}C\d{3}$/;
    return roadmap.pending
      .filter((discipline) => !syntheticPattern.test(discipline.code))
      .map((discipline) => ({
        code: discipline.code,
        label: `${discipline.code} - ${discipline.name}`
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [roadmap]);

  const sectorTables = useMemo(() => {
    if (!roadmap) {
      return [];
    }

    const electiveBucket = roadmap.progress.find((bucket) => bucket.key === "elective");
    const optionalBucket = roadmap.progress.find((bucket) => bucket.key === "optional");
    return sectorDefinitions.map((definition) => {
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
        .filter((node) =>
          definition.category === "OPTIONAL" ? node.category === "OPTIONAL" || node.category === "TRACK" : node.category === definition.category
        )
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
  }, [roadmap]);

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
  }, [roadmap]);

  const totalMissingCHT = useMemo(() => {
    if (!roadmap) {
      return 0;
    }

    return roadmap.progress.reduce((sum, bucket) => sum + bucket.missingCHT, 0);
  }, [roadmap]);

  const periodRoadmapData = useMemo(() => {
    if (!roadmap) {
      return null;
    }

    const periodIndexes = Array.from({ length: 8 }, (_, idx) => idx + 1);
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

      for (const node of roadmap.prereqGraph.nodes) {
        if (node.status === "OUTSIDE_SCOPE") {
          continue;
        }
        if (node.recommendedPeriod !== periodIndex) {
          continue;
        }

        const categoryKey = categoryMap.has(node.category) ? node.category : "UNKNOWN";
        const sector = sectors.get(categoryKey);
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

    const categories = periodCategoryDefinitions.filter((category) =>
      periods.some((period) => period.sectors.some((sector) => sector.key === category.key && sector.totalCHT > 0))
    );

    return { periods, categories };
  }, [roadmap]);

  const pendingTotals = useMemo(() => {
    if (!roadmap) {
      return { totalCht: 0, totalEstimatedChs: 0 };
    }

    const plannerPending = getPlannerPendingList(roadmap, gradeOptions);
    const totalCht = plannerPending.reduce((sum, item) => sum + item.cht, 0);
    return {
      totalCht,
      totalEstimatedChs: plannerPending.reduce((sum, item) => sum + estimateChsFromCht(item.cht), 0)
    };
  }, [gradeOptions, roadmap]);

  const plannerPendingCount = useMemo(() => {
    if (!roadmap) {
      return 0;
    }
    return getPlannerPendingList(roadmap, gradeOptions).length;
  }, [gradeOptions, roadmap]);

  const manualPlannerData = useMemo(() => {
    if (!roadmap) {
      return null;
    }

    const plannerPending = getPlannerPendingList(roadmap, gradeOptions);
    const pendingByCode = new Map(plannerPending.map((discipline) => [discipline.code, discipline]));
    const creditsByCode = new Map((gradeOptions?.availableByDiscipline ?? []).map((discipline) => [discipline.code, discipline.credits]));
    const slots = new Map(
      (gradeOptions?.availableByDiscipline ?? []).map((discipline) => [discipline.code, discipline.turmas[0]])
    );

    const assignedCodes = new Set(Object.values(manualPlan).flat());
    const unassigned = plannerPending.filter((discipline) => !assignedCodes.has(discipline.code));

    const basePeriodCount = Math.max(gradeOptions?.graduationPlan.periods.length ?? 0, 6);
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
  }, [gradeOptions, manualPlan, roadmap]);

  const selectedManualPeriod = useMemo(() => {
    if (!manualPlannerData) {
      return null;
    }
    return manualPlannerData.periods.find((period) => period.periodIndex === selectedPlanPeriod) ?? manualPlannerData.periods[0] ?? null;
  }, [manualPlannerData, selectedPlanPeriod]);

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
      roadmap,
      targetChsPerSemester: maxChsPerPeriod,
      includeCurrentSemesterIfInHistory: true
    });
  }, [maxChsPerPeriod, parsedTranscript, roadmap]);

  const chsPaceAudit = useMemo<GraduationForecastAudit | null>(() => {
    if (!parsedTranscript || !roadmap) {
      return null;
    }
    return buildGraduationForecastAudit({
      parsedTranscript,
      roadmap
    });
  }, [parsedTranscript, roadmap]);

  const dashboardVisualModel = useMemo(() => {
    if (!roadmap) {
      return null;
    }

    return buildDashboardVisualModel({
      roadmap,
      parsedTranscript,
      manualPlannerData,
      missingCht: chsPaceProjection?.missingCht ?? pendingTotals.totalCht,
      missingChs: chsPaceProjection?.missingChs ?? pendingTotals.totalEstimatedChs,
      missingChext: chsPaceProjection?.missingChext ?? 0
    });
  }, [chsPaceProjection, manualPlannerData, parsedTranscript, pendingTotals.totalCht, pendingTotals.totalEstimatedChs, roadmap]);

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
          data: chsPaceProjection.projected,
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
            <option value="981">Matriz 981</option>
            <option value="806">Matriz 806</option>
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
                    <th>Seção</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedTranscript.attempts.slice(0, 40).map((attempt, index) => (
                    <tr key={`${attempt.code}-${index}`}>
                      <td>{attempt.code}</td>
                      <td>{attempt.name}</td>
                      <td>{attempt.cht}</td>
                      <td>{attempt.average ?? "-"}</td>
                      <td>{attempt.frequency ?? "-"}</td>
                      <td>
                        <StatusPill variant={statusVariant(attempt.status)}>{attempt.status}</StatusPill>
                      </td>
                      <td>{attempt.sourceSection}</td>
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
            <p className="mt-2 text-[11px] text-slate-500">
              Gráficos de progresso consideram apenas CHT de disciplinas. CHEXT não é contabilizado aqui.
            </p>

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
                    <p className="text-[11px] text-slate-500">
                      CHEXT faltante (informativo): <strong>{chsPaceProjection.missingChext}h</strong>.
                    </p>
                    <p className="text-[11px] text-slate-500">{FORECAST_METHODOLOGY_NOTE}</p>
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
                  CHEXT faltante (informativo): <strong>{chsPaceAudit.missingChext ?? "-"}</strong>.
                </p>
                <p className="mt-1 text-[11px] text-slate-500">{chsPaceAudit.methodologyNote}</p>
              </div>
            ) : null}

            {periodRoadmapData ? (
              <div className="mt-5">
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

            <div className="mt-6 space-y-4">
              <h3 className="text-base font-bold text-slate-100">Optativas por Submódulo (360 + 345 + 135 = 840h)</h3>

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
                    {roadmap.progress.map((bucket) => (
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
                    Filtro aplicado: CHEXT foi removido da carga usada na montagem de grade.
                  </p>
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
                <p className="text-[11px] text-slate-400">Ajusta períodos e aplica mudanças no plano automaticamente.</p>
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
                  {message.planPatch ? (
                    <p className="mt-2 text-[11px] text-emerald-300">
                      Plano aplicado: período {message.planPatch.periodIndex} com {message.planPatch.achievedChs} CHS.
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
                placeholder="Ex: monte o período 3 com até 14 CHS e no máximo 1 tarde."
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
          <div className="mt-3 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Disciplina</th>
                  <th>CHT</th>
                  <th>Matérias relacionadas</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {roadmap.unusedDisciplines.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Nenhuma disciplina não utilizada.</td>
                  </tr>
                ) : (
                  roadmap.unusedDisciplines.map((item, index) => (
                    <tr key={`${item.code}-${index}`}>
                      <td>{item.code}</td>
                      <td>{item.name}</td>
                      <td>{item.cht}</td>
                      <td>{item.relatedSubjects?.join(", ") || `${item.code} - ${item.name}`}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
