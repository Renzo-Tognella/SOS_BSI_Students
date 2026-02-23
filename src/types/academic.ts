export type MatrixCode = "806" | "981";

export type DisciplineStatus =
  | "APPROVED"
  | "FAILED"
  | "CANCELED"
  | "TRANSFERRED"
  | "IN_PROGRESS"
  | "UNKNOWN";

export type DisciplineCategory =
  | "MANDATORY"
  | "OPTIONAL"
  | "TRACK"
  | "ELECTIVE"
  | "COMPLEMENTARY"
  | "INTERNSHIP"
  | "TCC"
  | "UNKNOWN";

export type TranscriptSection = "mandatory" | "optional" | "elective" | "other";

export interface StudentIdentity {
  registrationId?: string;
  fullName?: string;
  courseCode?: string;
  courseName?: string;
  period?: string;
  entry?: string;
}

export interface TranscriptAttempt {
  sourceSection: TranscriptSection;
  periodInMatrix?: number;
  code: string;
  name: string;
  classCode?: string;
  type?: string;
  chs?: number;
  cht: number;
  chext: number;
  average?: number | null;
  frequency?: number | null;
  semester?: number | null;
  year?: number | null;
  status: DisciplineStatus;
  statusText: string;
  rawBlock: string;
  normalizedCode?: string;
}

export interface MissingDiscipline {
  periodInMatrix?: number;
  code: string;
  name: string;
}

export interface SummaryRow {
  key: string;
  total?: number;
  taken?: number;
  approvedOrValidated?: number;
  missing?: number;
  approvedByStudent?: number;
}

export interface ExtensionSummaryRow {
  key: string;
  required?: number;
  taken?: number;
  missing?: number;
  situation?: string;
}

export interface ParsedTranscript {
  parserVersion: string;
  generatedAt: string;
  rawText: string;
  student: StudentIdentity;
  detectedMatrixCode?: MatrixCode;
  matrixLabel?: string;
  attempts: TranscriptAttempt[];
  explicitMissing: MissingDiscipline[];
  dependencies: MissingDiscipline[];
  summary: SummaryRow[];
  extensionSummary: ExtensionSummaryRow[];
  unparsedBlocks: string[];
  warnings: string[];
}

export type GraduationForecastMissingSource = "official_summary" | "roadmap_fallback";

export interface OfficialTranscriptMissingWorkload {
  mandatoryMissingCht: number;
  optionalMissingCht: number;
  electiveMissingCht: number;
  totalMissingCht: number;
  totalMissingChs: number;
  missingChext: number;
}

export interface GraduationForecastHistoryPoint {
  label: string;
  approvedChs: number;
}

export interface GraduationForecastProjectionPoint {
  label: string;
  projectedChs: number;
}

export interface GraduationForecast {
  labels: string[];
  historical: Array<number | null>;
  projected: Array<number | null>;
  startLabel: string;
  averageChs: number;
  projectionChs: number;
  missingCht: number;
  missingChs: number;
  missingChext: number;
  projectedSemesters: number;
  projectedEndSemester: string | null;
  historyBySemester: GraduationForecastHistoryPoint[];
  projectedBySemester: GraduationForecastProjectionPoint[];
  missingSource: GraduationForecastMissingSource;
  methodologyNote: string;
  chextNote: string;
}

export interface GraduationForecastAudit {
  officialMissingCht: number | null;
  officialMissingChs: number | null;
  internalMissingCht: number;
  internalMissingChs: number;
  differenceCht: number | null;
  differenceChs: number | null;
  missingChext: number | null;
  missingSource: GraduationForecastMissingSource;
  methodologyNote: string;
}

export interface CurriculumDiscipline {
  code: string;
  name: string;
  category: DisciplineCategory;
  subcategory?: string;
  track?: string;
  catalogOnly?: boolean;
  recommendedPeriod?: number;
  cht: number;
  chext?: number;
  prerequisites: string[];
}

export interface CurriculumTotals {
  mandatoryCHT: number;
  optionalCHT: number;
  electiveCHT: number;
  complementaryCHT: number;
  internshipCHT: number;
  tccCHT: number;
  extensionCHT: number;
}

export interface CurriculumMatrix {
  matrixCode: MatrixCode;
  courseCode: string;
  courseName: string;
  versionName: string;
  totals: CurriculumTotals;
  disciplines: CurriculumDiscipline[];
}

export interface MatrixCatalogDiscipline {
  code: string;
  name: string;
  period?: number;
  cht?: number;
  optGroup?: string | null;
}

export interface DisciplineLookupItem {
  code: string;
  name: string;
  category: DisciplineCategory;
  subcategory?: string;
  track?: string;
  matrixCode: MatrixCode;
  courseCode: string;
  courseAbbr: string;
  catalogOnly?: boolean;
}

export interface DisciplineLookupResponse {
  items: DisciplineLookupItem[];
}

export interface EquivalenceRule {
  fromCode: string;
  toCodes: string[];
  note?: string;
}

export interface ProgressBucket {
  key:
    | "mandatory"
    | "optional"
    | "elective"
    | "complementary"
    | "internship"
    | "tcc"
    | "extension";
  label: string;
  requiredCHT: number;
  completedCHT: number;
  validatedCHT: number;
  missingCHT: number;
}

export type GraphNodeStatus = "DONE" | "AVAILABLE" | "BLOCKED" | "OUTSIDE_SCOPE";

export interface PrereqGraphNode {
  code: string;
  name: string;
  status: GraphNodeStatus;
  category: DisciplineCategory;
  subcategory?: string;
  track?: string;
  recommendedPeriod?: number;
  cht: number;
  prerequisites: string[];
  dependents: string[];
}

export interface PrereqGraphEdge {
  from: string;
  to: string;
}

export interface UnusedDiscipline {
  code: string;
  name: string;
  cht: number;
  reason: string;
  relatedSubjects?: string[];
}

export interface PendingDiscipline {
  code: string;
  name: string;
  category: DisciplineCategory;
  subcategory?: string;
  recommendedPeriod?: number;
  prerequisites: string[];
  blockedBy: string[];
  status: "AVAILABLE" | "BLOCKED";
  cht: number;
  chext?: number;
}

export interface ManualCorrelationInput {
  sourceCode?: string;
  sourceName?: string;
  targetCode: string;
}

export interface CorrelationSuggestion {
  code: string;
  name: string;
  strategy: "CODE" | "NAME";
}

export interface UnmatchedApprovedAttempt {
  sourceCode: string;
  sourceName: string;
  sourceSection: TranscriptSection;
  cht: number;
  year?: number | null;
  semester?: number | null;
  suggestedTargets: CorrelationSuggestion[];
}

export interface ElectiveOption {
  code: string;
  name: string;
  cht: number;
  recommendedPeriod?: number;
  status: "DONE" | "AVAILABLE";
}

export interface RoadmapResult {
  matrixCode: MatrixCode;
  student: StudentIdentity;
  progress: ProgressBucket[];
  pending: PendingDiscipline[];
  prereqGraph: {
    nodes: PrereqGraphNode[];
    edges: PrereqGraphEdge[];
  };
  unusedDisciplines: UnusedDiscipline[];
  unmatchedApprovedAttempts: UnmatchedApprovedAttempt[];
  electiveOptions?: ElectiveOption[];
  alerts: string[];
  transcriptWarnings: string[];
  computedAt: string;
}

export interface GradeHora {
  horario: string;
  sala: string;
}

export interface GradeTurma {
  codigo: string;
  enquadramento?: string;
  vagas_total: number;
  vagas_calouros: number;
  reserva: string;
  prioridade_cursos: string[][];
  horarios: GradeHora[];
  professores: string[];
  optativa_matrizes: string[];
}

export interface GradeDiscipline {
  codigo: string;
  nome: string;
  creditos: number | null;
  creditos_assincronos?: number | null;
  turmas: GradeTurma[];
}

export interface GradeNaHoraCourse {
  curso: string;
  ultima_atualizacao: string;
  disciplinas: GradeDiscipline[];
}

export interface ScheduledClass {
  disciplineCode: string;
  disciplineName: string;
  classCode: string;
  horarios: GradeHora[];
  professores: string[];
  weeklyCredits: number | null;
}

export interface ScheduleCombination {
  classes: ScheduledClass[];
  weeklyCredits: number;
  coveredPendingCodes: string[];
  conflictCountAvoided: number;
}

export interface PlanAgendaEntry {
  dayLabel: string;
  shiftLabel: string;
  slot: string;
  code: string;
  disciplineCode: string;
  disciplineName: string;
  classCode?: string;
  room?: string;
}

export interface PlanPeriodDiscipline {
  code: string;
  name: string;
  category: DisciplineCategory;
  recommendedPeriod?: number;
  cht: number;
  estimatedChs: number;
  classCode?: string;
  scheduled: boolean;
  horarios: GradeHora[];
  professores: string[];
  note?: string;
}

export interface GraduationPlanPeriod {
  periodIndex: number;
  totalEstimatedChs: number;
  totalCht: number;
  scheduledEstimatedChs: number;
  unscheduledEstimatedChs: number;
  disciplines: PlanPeriodDiscipline[];
  agenda: PlanAgendaEntry[];
}

export interface GraduationPlan {
  targetChsPerPeriod: number;
  totalMissingCht: number;
  totalMissingEstimatedChs: number;
  periods: GraduationPlanPeriod[];
  remainingCodes: string[];
  remainingMissingCht: number;
  remainingMissingEstimatedChs: number;
  warnings: string[];
}

export interface GradeOptionsResponse {
  matrixCode: MatrixCode;
  campus: string;
  course: string;
  semesterUsed: string;
  lastUpdate: string;
  requestedCodes: string[];
  availableByDiscipline: Array<{
    code: string;
    name: string;
    credits: number | null;
    turmas: GradeTurma[];
  }>;
  combinations: ScheduleCombination[];
  graduationPlan: GraduationPlan;
  warnings: string[];
}

export interface AssistantScheduleConstraint {
  targetChsPerPeriod?: number;
  offSemesters?: number;
  workStartHour?: number;
  workEndHour?: number;
  maxAfternoonDays?: number;
  maxAfternoonClasses?: number;
  allowedShifts?: Array<"M" | "T" | "N">;
  blockedShifts?: Array<"M" | "T" | "N">;
}

export interface AssistantPlanClass {
  code: string;
  name: string;
  classCode: string;
  horarios: GradeHora[];
  weeklyCredits: number;
}

export interface AssistantPlanPatch {
  periodIndex: number;
  targetChs: number;
  achievedChs: number;
  constraintsApplied: AssistantScheduleConstraint;
  classes: AssistantPlanClass[];
  payload: {
    periodIndex: number;
    disciplines: string[];
    classes: Array<{
      code: string;
      classCode: string;
      horarios: string[];
      weeklyCredits: number;
    }>;
  };
}

export interface AssistantChatResponse {
  answer: string;
  detectedIntent:
    | "PLAN_SCHEDULE"
    | "GRADUATION_ESTIMATE"
    | "TRACK_IA"
    | "AVAILABLE_DISCIPLINES"
    | "GENERAL_HELP";
  detectedConstraints?: AssistantScheduleConstraint;
  planPatch?: AssistantPlanPatch;
  providerUsed?: "openrouter" | "gemini" | "rule-based";
  diagnostics?: string[];
}
