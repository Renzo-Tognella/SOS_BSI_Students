import type { GradeNaHoraCourse } from "@/types/academic";

const BASE_URL = "https://gradenahora.com.br/utfpr";

export interface GradeNaHoraFetchResult {
  semester: string;
  url: string;
  course: GradeNaHoraCourse;
}

export function buildGradeNaHoraFilename(semester: string, campus: string, course: string): string {
  const semCompact = semester.replace("-", "0");
  const campusPart = campus.padStart(2, "0");
  const coursePart = `00${course.padStart(3, "0")}`;
  return `listahorario${campusPart}${semCompact}${coursePart}.json`;
}

export function buildGradeNaHoraUrl(semester: string, campus: string, course: string): string {
  const filename = buildGradeNaHoraFilename(semester, campus, course);
  return `${BASE_URL}/${semester}/${filename}`;
}

export async function fetchGradeNaHoraCourse(semester: string, campus: string, course: string): Promise<GradeNaHoraFetchResult> {
  const url = buildGradeNaHoraUrl(semester, campus, course);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} em ${url}`);
  }

  const payload = (await response.json()) as GradeNaHoraCourse;
  if (!payload || !Array.isArray(payload.disciplinas)) {
    throw new Error(`Formato inválido de resposta do GradeNaHora em ${url}`);
  }

  return {
    semester,
    url,
    course: payload
  };
}
