export type SubjectRoadmapState = "LOCKED" | "AVAILABLE" | "IN_PROGRESS" | "COMPLETED";

export interface SubjectRoadmapItem {
  code: string;
  name: string;
  period: number | null;
  cht: number;
  state: SubjectRoadmapState;
  completionPercent: number;
  prerequisites: string[];
  grade: number | null;
  recentScores: number[];
}

export type AcademicEventType = "exam" | "assignment" | "live";

export interface AcademicEventItem {
  id: string;
  title: string;
  subtitle?: string;
  subjectCode?: string;
  type: AcademicEventType;
  startsAt: string;
  countdownLabel: string;
  preparationPercent: number;
  completed: boolean;
}

export interface DashboardSeriesPoint {
  label: string;
  value: number;
}

export interface DashboardRadarModel {
  labels: string[];
  student: number[];
  cohortReference: number[];
}

export interface DashboardHeatmapCell {
  day: string;
  intensity: number;
  hours: number;
}

export interface NextClassModel {
  title: string;
  subtitle: string;
  countdownLabel: string;
  startsAt: string;
  materialCount: number;
  online: boolean;
}

export interface DashboardVisualModel {
  overallProgressPercent: number;
  completedSubjects: number;
  totalSubjects: number;
  streakDays: number;
  nextMilestone: string;
  averageGrade: number | null;
  averageGradeDelta: number;
  totalStudyHours: number;
  rankingLabel: string;
  missingCht: number;
  missingChs: number;
  missingChext: number;
  subjects: SubjectRoadmapItem[];
  performanceVelocity: DashboardSeriesPoint[];
  projectedVelocity: DashboardSeriesPoint[];
  skillsRadar: DashboardRadarModel;
  studyDistribution: DashboardHeatmapCell[];
  events: AcademicEventItem[];
  nextClass: NextClassModel | null;
  suggestions: string[];
  focusCode: string | null;
}
