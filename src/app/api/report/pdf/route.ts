import { NextResponse } from "next/server";
import { z } from "zod";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { FORECAST_METHODOLOGY_NOTE } from "@/lib/domain/graduation-forecast";
import type { ParsedTranscript, RoadmapResult } from "@/types/academic";

export const runtime = "nodejs";

const requestSchema = z.object({
  roadmap: z.custom<RoadmapResult>((value) => typeof value === "object" && value !== null, "roadmap inválido"),
  parsedTranscript: z.custom<ParsedTranscript>((value) => typeof value === "object" && value !== null, "parsedTranscript inválido").optional(),
  plannerSnapshot: z
    .array(
      z.object({
        periodIndex: z.number().int().min(1),
        totalChs: z.number(),
        totalCht: z.number(),
        disciplines: z.array(
          z.object({
            code: z.string(),
            name: z.string(),
            cht: z.number(),
            estimatedChs: z.number()
          })
        )
      })
    )
    .optional()
});

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function makeHtmlReport(
  roadmap: RoadmapResult,
  parsedTranscript?: ParsedTranscript,
  plannerSnapshot?: Array<{
    periodIndex: number;
    totalChs: number;
    totalCht: number;
    disciplines: Array<{ code: string; name: string; cht: number; estimatedChs: number }>;
  }>
): string {
  const studentName = roadmap.student.fullName ?? "Aluno não identificado";
  const registration = roadmap.student.registrationId ?? "-";
  const generatedAt = new Date().toLocaleString("pt-BR");

  const progressRows = roadmap.progress
    .map(
      (bucket) => `
      <tr>
        <td>${escapeHtml(bucket.label)}</td>
        <td>${bucket.requiredCHT}</td>
        <td>${bucket.completedCHT}</td>
        <td>${bucket.validatedCHT}</td>
        <td>${bucket.missingCHT}</td>
      </tr>`
    )
    .join("\n");

  const pendingRows = roadmap.pending
    .slice(0, 40)
    .map(
      (discipline) => `
      <tr>
        <td>${escapeHtml(discipline.code)}</td>
        <td>${escapeHtml(discipline.name)}</td>
        <td>${escapeHtml(discipline.status)}</td>
        <td>${escapeHtml(discipline.blockedBy.join(", ") || "-")}</td>
      </tr>`
    )
    .join("\n");

  const unusedRows = roadmap.unusedDisciplines
    .slice(0, 30)
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.code)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${item.cht}</td>
        <td>${escapeHtml((item.relatedSubjects ?? []).join(", ") || `${item.code} - ${item.name}`)}</td>
        <td>${escapeHtml(item.reason)}</td>
      </tr>`
    )
    .join("\n");

  const warnings = [...roadmap.alerts, ...roadmap.transcriptWarnings]
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("\n");
  const plannerRows = (plannerSnapshot ?? [])
    .map((period) => {
      const disciplineList =
        period.disciplines.length === 0
          ? "Sem disciplinas"
          : period.disciplines.map((discipline) => `${discipline.code} (${discipline.estimatedChs} CHS)`).join(", ");
      return `
      <tr>
        <td>${period.periodIndex}</td>
        <td>${period.totalChs}</td>
        <td>${period.totalCht}</td>
        <td>${escapeHtml(disciplineList)}</td>
      </tr>`;
    })
    .join("\n");

  const unparsedCount = parsedTranscript?.unparsedBlocks.length ?? 0;

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Relatório Roadmap Acadêmico</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; margin: 24px; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  h2 { margin-top: 24px; font-size: 18px; }
  p { margin: 4px 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; font-size: 12px; }
  th { background: #f3f4f6; }
  .meta { background: #eef2ff; padding: 12px; border-radius: 8px; }
  .warning { background: #fff7ed; border: 1px solid #fed7aa; padding: 12px; border-radius: 8px; }
  .small { font-size: 11px; color: #6b7280; }
</style>
</head>
<body>
  <h1>Roadmap Acadêmico - SI UTFPR</h1>
  <div class="meta">
    <p><strong>Aluno:</strong> ${escapeHtml(studentName)}</p>
    <p><strong>RA:</strong> ${escapeHtml(registration)}</p>
    <p><strong>Matriz:</strong> ${escapeHtml(roadmap.matrixCode)}</p>
    <p><strong>Gerado em:</strong> ${escapeHtml(generatedAt)}</p>
    <p><strong>Blocos para revisão manual:</strong> ${unparsedCount}</p>
  </div>

  <h2>Progresso por Categoria</h2>
  <table>
    <thead>
      <tr>
        <th>Categoria</th>
        <th>CHT Requerida</th>
        <th>CHT Concluída</th>
        <th>CHT Validada</th>
        <th>CHT Faltante</th>
      </tr>
    </thead>
    <tbody>${progressRows}</tbody>
  </table>

  <h2>Disciplinas Pendentes</h2>
  <table>
    <thead>
      <tr><th>Código</th><th>Disciplina</th><th>Status</th><th>Bloqueios</th></tr>
    </thead>
    <tbody>${pendingRows || "<tr><td colspan='4'>Nenhuma pendência identificada.</td></tr>"}</tbody>
  </table>

  <h2>Plano de Grade (Atual)</h2>
  <table>
    <thead>
      <tr><th>Período</th><th>CHS</th><th>CHT</th><th>Disciplinas</th></tr>
    </thead>
    <tbody>${plannerRows || "<tr><td colspan='4'>Plano não gerado no momento da exportação.</td></tr>"}</tbody>
  </table>

  <h2>Disciplinas Não Utilizadas</h2>
  <table>
    <thead>
      <tr><th>Código</th><th>Disciplina</th><th>CHT</th><th>Matérias relacionadas</th><th>Motivo</th></tr>
    </thead>
    <tbody>${unusedRows || "<tr><td colspan='5'>Nenhuma disciplina não utilizada.</td></tr>"}</tbody>
  </table>

  <h2>Alertas e Observações</h2>
  <div class="warning">
    <ul>${warnings || "<li>Sem alertas.</li>"}</ul>
  </div>

  <p class="small"><strong>Nota metodológica:</strong> ${escapeHtml(FORECAST_METHODOLOGY_NOTE)}</p>
  <p class="small">Relatório gerado automaticamente pelo MVP Roadmap SI UTFPR.</p>
</body>
</html>`;
}

async function generatePdfWithPuppeteer(html: string): Promise<Buffer> {
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function generateFallbackPdf(roadmap: RoadmapResult): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  page.drawText("Roadmap Academico - SI UTFPR", { x: 40, y, size: 16, font: bold, color: rgb(0.1, 0.1, 0.1) });
  y -= 24;
  page.drawText(`Aluno: ${roadmap.student.fullName ?? "-"}`, { x: 40, y, size: 11, font });
  y -= 16;
  page.drawText(`RA: ${roadmap.student.registrationId ?? "-"} | Matriz: ${roadmap.matrixCode}`, { x: 40, y, size: 11, font });
  y -= 24;

  page.drawText("Progresso:", { x: 40, y, size: 12, font: bold });
  y -= 16;
  for (const bucket of roadmap.progress) {
    page.drawText(`${bucket.label}: ${bucket.completedCHT}/${bucket.requiredCHT} (faltante ${bucket.missingCHT})`, { x: 40, y, size: 10, font });
    y -= 14;
    if (y < 100) {
      break;
    }
  }

  y -= 8;
  page.drawText(`Pendencias: ${roadmap.pending.length} | Nao utilizadas: ${roadmap.unusedDisciplines.length}`, { x: 40, y, size: 10, font });
  y -= 18;
  page.drawText(`Nota metodologica: ${FORECAST_METHODOLOGY_NOTE}`, { x: 40, y, size: 9, font });

  return Buffer.from(await document.save());
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = requestSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Payload inválido para relatório.",
          issues: parsed.error.issues
        },
        { status: 400 }
      );
    }

    const { roadmap, parsedTranscript, plannerSnapshot } = parsed.data;
    const html = makeHtmlReport(roadmap, parsedTranscript, plannerSnapshot);

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generatePdfWithPuppeteer(html);
    } catch {
      pdfBuffer = await generateFallbackPdf(roadmap);
    }

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="roadmap-academico.pdf"'
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Falha ao gerar PDF.",
        details: (error as Error).message
      },
      { status: 500 }
    );
  }
}
