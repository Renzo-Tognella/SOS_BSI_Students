import type { MatrixCode } from "@/types/academic";

export const MATRIX_CODE_VALUES = ["806", "981", "962"] as const;

export type OptionalPoolModuleKey = "second" | "tracks" | "humanities";

export interface OptionalPoolModuleDefinition {
  key: OptionalPoolModuleKey;
  label: string;
  requiredCHT: number;
}

interface MatrixOfficialSources {
  courseUrl: string;
  matrixUrl: string;
}

export interface MatrixMetadata {
  matrixCode: MatrixCode;
  courseCode: string;
  campusCode: string;
  courseName: string;
  courseAbbreviation: string;
  officialSources: MatrixOfficialSources;
  optionalPoolModules: OptionalPoolModuleDefinition[];
}

const BSI_COURSE_URL =
  "https://www.utfpr.edu.br/cursos/coordenacoes/graduacao/curitiba/ct-bacharelado-em-sistemas-de-informacao";
const BSI_MATRIX_URL =
  "https://www.utfpr.edu.br/cursos/coordenacoes/graduacao/curitiba/ct-bacharelado-em-sistemas-de-informacao/matriz-e-docentes";

const ENGCOMP_COURSE_URL =
  "https://www.utfpr.edu.br/cursos/coordenacoes/graduacao/curitiba/ct-bacharelado-em-engenharia-de-computacao";
const ENGCOMP_MATRIX_URL =
  "https://www.utfpr.edu.br/cursos/coordenacoes/graduacao/curitiba/ct-bacharelado-em-engenharia-de-computacao/matriz-e-docentes";

const BSI_806_OPTIONAL_POOL: OptionalPoolModuleDefinition[] = [
  { key: "second", label: "Segundo Estrato", requiredCHT: 360 },
  { key: "tracks", label: "Terceiro Estrato - Trilhas em Computação", requiredCHT: 345 },
  { key: "humanities", label: "Optativas", requiredCHT: 60 }
];

const BSI_981_OPTIONAL_POOL: OptionalPoolModuleDefinition[] = [
  { key: "second", label: "Segundo Estrato", requiredCHT: 360 },
  { key: "tracks", label: "Terceiro Estrato - Trilhas em Computação", requiredCHT: 345 },
  { key: "humanities", label: "Optativas do Ciclo de Humanidades", requiredCHT: 135 }
];

const ENGCOMP_OPTIONAL_POOL: OptionalPoolModuleDefinition[] = [
  { key: "second", label: "Opção de Expressão Gráfica", requiredCHT: 30 },
  { key: "tracks", label: "Optativas Profissionalizantes", requiredCHT: 270 },
  { key: "humanities", label: "Optativas do Ciclo de Humanidades", requiredCHT: 120 }
];

export const MATRIX_METADATA_BY_CODE: Record<MatrixCode, MatrixMetadata> = {
  "806": {
    matrixCode: "806",
    courseCode: "236",
    campusCode: "01",
    courseName: "Bacharelado em Sistemas de Informação",
    courseAbbreviation: "BSI",
    officialSources: {
      courseUrl: BSI_COURSE_URL,
      matrixUrl: BSI_MATRIX_URL
    },
    optionalPoolModules: BSI_806_OPTIONAL_POOL
  },
  "981": {
    matrixCode: "981",
    courseCode: "236",
    campusCode: "01",
    courseName: "Bacharelado em Sistemas de Informação",
    courseAbbreviation: "BSI",
    officialSources: {
      courseUrl: BSI_COURSE_URL,
      matrixUrl: BSI_MATRIX_URL
    },
    optionalPoolModules: BSI_981_OPTIONAL_POOL
  },
  "962": {
    matrixCode: "962",
    courseCode: "212",
    campusCode: "01",
    courseName: "Bacharelado em Engenharia de Computação",
    courseAbbreviation: "ECOMP",
    officialSources: {
      courseUrl: ENGCOMP_COURSE_URL,
      matrixUrl: ENGCOMP_MATRIX_URL
    },
    optionalPoolModules: ENGCOMP_OPTIONAL_POOL
  }
};

export function isSupportedMatrixCode(value: string | null | undefined): value is MatrixCode {
  if (!value) {
    return false;
  }
  return MATRIX_CODE_VALUES.includes(value as MatrixCode);
}

export function getMatrixMetadata(matrixCode: MatrixCode): MatrixMetadata {
  return MATRIX_METADATA_BY_CODE[matrixCode];
}

export function inferMatrixCodeFromCourseCode(courseCode?: string | null): MatrixCode | null {
  const normalized = (courseCode ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized === "212") {
    return "962";
  }
  if (normalized === "236") {
    return "981";
  }
  return null;
}

export function resolveCourseCodeForMatrix(matrixCode: MatrixCode, preferredCourseCode?: string | null): string {
  const normalized = (preferredCourseCode ?? "").trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return MATRIX_METADATA_BY_CODE[matrixCode].courseCode;
}

export function resolveCampusCodeForMatrix(matrixCode: MatrixCode, preferredCampusCode?: string | null): string {
  const normalized = (preferredCampusCode ?? "").trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return MATRIX_METADATA_BY_CODE[matrixCode].campusCode;
}

export function inferCourseAbbreviation(courseName?: string | null, courseCode?: string | null): string {
  const normalized = (courseName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("sistemas de informacao")) {
    return "BSI";
  }
  if (normalized.includes("engenharia de computacao")) {
    return "ECOMP";
  }
  if (normalized.includes("engenharia de software")) {
    return "ES";
  }

  const cleanCode = (courseCode ?? "").trim();
  return cleanCode ? `C${cleanCode}` : "N/D";
}

export function getOptionalPoolModules(matrixCode: MatrixCode): OptionalPoolModuleDefinition[] {
  return MATRIX_METADATA_BY_CODE[matrixCode].optionalPoolModules;
}
