import { NextResponse } from "next/server";
import { z } from "zod";

import { calculateRoadmap } from "@/lib/domain/matriz-engine";
import { parseHistoricoText } from "@/lib/parser/historico-parser";
import type { ManualCorrelationInput, MatrixCode, ParsedTranscript } from "@/types/academic";

export const runtime = "nodejs";

const matrixCodeSchema = z.enum(["806", "981"] as const);

const requestSchema = z.object({
  parsedTranscript: z.custom<ParsedTranscript>((value) => typeof value === "object" && value !== null, "parsedTranscript inválido"),
  matrixCode: matrixCodeSchema.optional(),
  manualMappings: z
    .array(
      z.object({
        sourceCode: z.string().optional(),
        sourceName: z.string().optional(),
        targetCode: z.string().optional(),
        targetCategory: z
          .enum(["MANDATORY", "OPTIONAL", "TRACK", "ELECTIVE", "COMPLEMENTARY", "INTERNSHIP", "TCC", "UNKNOWN"] as const)
          .optional(),
        creditedCHT: z.number().optional(),
        manualOnly: z.boolean().optional(),
        customDisciplineName: z.string().optional(),
        customDisciplineCode: z.string().optional()
      })
    )
    .optional()
});

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsedInput = requestSchema.safeParse(payload);

    if (!parsedInput.success) {
      return NextResponse.json(
        {
          error: "Payload inválido para cálculo do roadmap.",
          issues: parsedInput.error.issues
        },
        { status: 400 }
      );
    }

    const { parsedTranscript, matrixCode, manualMappings } = parsedInput.data;
    const transcriptForCalculation =
      typeof parsedTranscript.rawText === "string" && parsedTranscript.rawText.trim().length > 0
        ? parseHistoricoText(parsedTranscript.rawText)
        : parsedTranscript;

    const roadmap = await calculateRoadmap(
      transcriptForCalculation,
      matrixCode as MatrixCode | undefined,
      manualMappings as ManualCorrelationInput[] | undefined
    );
    return NextResponse.json(roadmap);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Falha ao calcular o roadmap acadêmico.",
        details: (error as Error).message
      },
      { status: 500 }
    );
  }
}
