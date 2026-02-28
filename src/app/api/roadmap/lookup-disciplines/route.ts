import { NextResponse } from "next/server";

import { inferCourseAbbreviation, MATRIX_CODE_VALUES } from "@/lib/domain/matrix-metadata";
import { loadCurriculumMatrix } from "@/lib/domain/matriz-engine";
import type { DisciplineLookupItem, MatrixCode } from "@/types/academic";

export const runtime = "nodejs";

const SUPPORTED_MATRICES: MatrixCode[] = [...MATRIX_CODE_VALUES];

export async function GET() {
  try {
    const matrices = [];
    const warnings: string[] = [];

    for (const matrixCode of SUPPORTED_MATRICES) {
      try {
        const matrix = await loadCurriculumMatrix(matrixCode);
        matrices.push(matrix);
      } catch (error) {
        warnings.push(`Matriz ${matrixCode} indisponível: ${(error as Error).message}`);
      }
    }

    if (matrices.length === 0) {
      throw new Error("Nenhuma matriz curricular pôde ser carregada.");
    }

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
    return NextResponse.json(warnings.length > 0 ? { items: output, warnings } : { items: output });
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
