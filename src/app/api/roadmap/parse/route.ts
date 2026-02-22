import { NextResponse } from "next/server";

import { loadMatrixCatalogByCode } from "@/lib/domain/matrix-catalog";
import { normalizeDisciplineCode } from "@/lib/utils/academic";
import { parseHistoricoPdfBuffer } from "@/lib/parser/historico-parser";
import type { MatrixCode } from "@/types/academic";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("pdf") ?? formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo PDF não enviado no campo 'pdf' (ou 'file')." }, { status: 400 });
    }

    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "Formato inválido. Envie um arquivo PDF." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const parsed = await parseHistoricoPdfBuffer(Buffer.from(arrayBuffer));

    const matrixCode = parsed.detectedMatrixCode as MatrixCode | undefined;
    if (matrixCode) {
      const catalogByCode = await loadMatrixCatalogByCode(matrixCode);
      parsed.attempts = parsed.attempts.map((attempt) => {
        const normalizedCode = normalizeDisciplineCode(attempt.code);
        const canonical = catalogByCode.get(normalizedCode);
        if (!canonical?.name) {
          return attempt;
        }

        return {
          ...attempt,
          code: canonical.code,
          normalizedCode: canonical.code,
          name: canonical.name
        };
      });
    }

    return NextResponse.json(parsed);
  } catch (error) {
    return NextResponse.json(
      {
        error: "Falha ao processar o PDF do histórico.",
        details: (error as Error).message
      },
      { status: 500 }
    );
  }
}
