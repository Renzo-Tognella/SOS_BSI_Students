import { NextResponse } from "next/server";

import { loadCurriculumMatrix } from "@/lib/domain/matriz-engine";
import type { DisciplineLookupItem, MatrixCode } from "@/types/academic";

export const runtime = "nodejs";

const SUPPORTED_MATRICES: MatrixCode[] = ["806", "981"];

function inferCourseAbbreviation(courseName: string, courseCode: string): string {
  const normalized = courseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (normalized.includes("sistemas de informacao")) {
    return "BSI";
  }
  if (normalized.includes("engenharia de software")) {
    return "ES";
  }
  return `C${courseCode}`;
}

export async function GET() {
  try {
    const matrices = await Promise.all(SUPPORTED_MATRICES.map((matrixCode) => loadCurriculumMatrix(matrixCode)));
    const output: DisciplineLookupItem[] = [];
    const seen = new Set<string>();

    for (const matrix of matrices) {
      const courseAbbr = inferCourseAbbreviation(matrix.courseName, matrix.courseCode);
      for (const discipline of matrix.disciplines) {
        const code = discipline.code.trim().toUpperCase();
        if (!code) {
          continue;
        }

        const dedupeKey = `${matrix.matrixCode}:${code}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);

        output.push({
          code,
          name: discipline.name,
          category: discipline.category,
          subcategory: discipline.subcategory,
          track: discipline.track,
          matrixCode: matrix.matrixCode,
          courseCode: matrix.courseCode,
          courseAbbr,
          catalogOnly: discipline.catalogOnly
        });
      }
    }

    output.sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code) || a.matrixCode.localeCompare(b.matrixCode));
    return NextResponse.json({ items: output });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Falha ao carregar lista de disciplinas para convalidação.",
        details: (error as Error).message
      },
      { status: 500 }
    );
  }
}
