import { NextResponse } from "next/server";
import { z } from "zod";

import { MATRIX_CODE_VALUES } from "@/lib/domain/matrix-metadata";
import { buildGradeOptions, extractUniqueRequestedCodes } from "@/lib/integrations/gradenahora-scheduler";

export const runtime = "nodejs";

const querySchema = z.object({
  matrix: z.enum(MATRIX_CODE_VALUES),
  course: z.string().min(1),
  campus: z.string().min(1),
  pending: z.string().optional(),
  maxChs: z.coerce.number().int().min(1).max(40).optional()
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      matrix: searchParams.get("matrix"),
      course: searchParams.get("course"),
      campus: searchParams.get("campus"),
      pending: searchParams.get("pending") ?? undefined,
      maxChs: searchParams.get("maxChs") ?? undefined
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: "Parâmetros inválidos para consulta de grade.",
          issues: parsedQuery.error.issues
        },
        { status: 400 }
      );
    }

    const { matrix, course, campus, pending, maxChs } = parsedQuery.data;

    const response = await buildGradeOptions({
      matrixCode: matrix,
      course,
      campus,
      requestedCodes: extractUniqueRequestedCodes(pending ?? null),
      maxChsPerPeriod: maxChs
    });

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Falha ao consultar GradeNaHora.",
        details: (error as Error).message
      },
      { status: 500 }
    );
  }
}
