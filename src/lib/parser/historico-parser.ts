import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ExtensionSummaryRow,
  MatrixCode,
  MissingDiscipline,
  ParsedTranscript,
  SummaryRow,
  TranscriptAttempt,
  TranscriptSection
} from "@/types/academic";
import {
  normalizeDisciplineCode,
  normalizeStatus,
  normalizeWhitespace,
  parseIntSafe,
  parsePtNumber
} from "@/lib/utils/academic";
import { detectSections, sliceByRange } from "@/lib/parser/section-detectors";

const execFileAsync = promisify(execFile);
const MIN_TEXT_SIZE_FOR_NO_OCR = 3000;
const PARSER_VERSION = "1.0.0";

interface ExtractTextResult {
  text: string;
  usedOcr: boolean;
  warnings: string[];
}

function parseTableNumber(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sanitizeName(raw: string, fallbackCode: string): string {
  const cleaned = normalizeWhitespace(raw)
    .replace(/\s{2,}/g, " ")
    .replace(/\s+-\s+$/, "")
    .trim();
  return cleaned || fallbackCode;
}

function parseAttemptBlocks(sectionText: string, sourceSection: TranscriptSection): { attempts: TranscriptAttempt[]; unparsed: string[] } {
  const lines = sectionText.split(/\r?\n/);
  const rowStartRegex = /^\s*(\d+)\s+([A-Z0-9]{4,8})\b/;
  const starts: number[] = [];

  lines.forEach((line, index) => {
    if (rowStartRegex.test(line)) {
      starts.push(index);
    }
  });

  const attempts: TranscriptAttempt[] = [];
  const unparsed: string[] = [];

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const blockLines = lines.slice(start, end);
    const rowLine = blockLines[0] ?? "";
    const headMatch = rowLine.match(rowStartRegex);
    if (!headMatch) {
      unparsed.push(blockLines.join("\n"));
      continue;
    }

    const periodInMatrix = parseIntSafe(headMatch[1]);
    const code = normalizeDisciplineCode(headMatch[2]);

    const tailMatch = rowLine.match(/(\d+)\s+(\d+)\s+(\d+)\s+([0-9*,]+)\s+([0-9*,]+)\s+([12])\s+(\d{4})(?:\s+(.*))?$/);
    if (!tailMatch) {
      unparsed.push(blockLines.join("\n"));
      continue;
    }

    const [fullTail, chsRaw, chtRaw, chextRaw, avgRaw, freqRaw, semRaw, yearRaw, statusTailRaw] = tailMatch;
    const prefix = rowLine.slice(0, rowLine.length - fullTail.length).trim();

    const prefixWithoutPeriodCode = prefix.replace(/^\d+\s+[A-Z0-9]{4,8}\s*/, "").trim();
    const tokens = prefixWithoutPeriodCode.split(/\s+/).filter(Boolean);

    const classCode = tokens.find((token) => /^[A-Z]\d{2,3}$/.test(token));
    const type = tokens.find((token) => /^[RFEDS]$/.test(token));

    const nameTokens = tokens.filter((token) => token !== classCode && token !== type);
    const parsedName = nameTokens.join(" ");
    const joinedBlock = blockLines.join("\n");
    const statusText = normalizeWhitespace([statusTailRaw ?? "", joinedBlock].join(" "));
    const average = parsePtNumber(avgRaw);
    const frequency = parsePtNumber(freqRaw);

    attempts.push({
      sourceSection,
      periodInMatrix,
      code,
      normalizedCode: code,
      name: sanitizeName(parsedName, code),
      classCode,
      type,
      chs: parseIntSafe(chsRaw),
      cht: parseIntSafe(chtRaw) ?? 0,
      chext: parseIntSafe(chextRaw) ?? 0,
      average,
      frequency,
      semester: parseIntSafe(semRaw) ?? null,
      year: parseIntSafe(yearRaw) ?? null,
      status: normalizeStatus(statusText, { average, frequency }),
      statusText,
      rawBlock: joinedBlock
    });
  }

  return { attempts, unparsed };
}

function parseMissingTable(sectionText: string, includePeriod = true): MissingDiscipline[] {
  const lines = sectionText.split(/\r?\n/);
  const output: MissingDiscipline[] = [];

  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized || normalized.startsWith("Semestre") || normalized.startsWith("Código") || normalized.startsWith("***")) {
      continue;
    }

    if (includePeriod) {
      const match = normalized.match(/^(\d+)\s+([A-Z0-9]{4,8})\s+(.+)$/);
      if (match) {
        output.push({
          periodInMatrix: parseIntSafe(match[1]),
          code: normalizeDisciplineCode(match[2]),
          name: normalizeWhitespace(match[3])
        });
      }
      continue;
    }

    const match = normalized.match(/^([A-Z0-9]{4,8})\s+(.+)$/);
    if (match) {
      output.push({
        code: normalizeDisciplineCode(match[1]),
        name: normalizeWhitespace(match[2])
      });
    }
  }

  return output;
}

function parseSummaryTable(sectionText: string): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const lines = sectionText.split(/\r?\n/);

  for (const line of lines) {
    const clean = line.trim();
    if (!clean.startsWith("CHT ")) {
      continue;
    }

    const match = clean.match(/^(CHT.+?)\s+([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)(?:\s+([0-9.,]+))?$/);
    if (!match) {
      continue;
    }

    rows.push({
      key: match[1].trim(),
      total: parseTableNumber(match[2]),
      taken: parseTableNumber(match[3]),
      approvedOrValidated: parseTableNumber(match[4]),
      missing: parseTableNumber(match[5]),
      approvedByStudent: parseTableNumber(match[6])
    });
  }

  return rows;
}

function parseExtensionSummary(sectionText: string): ExtensionSummaryRow[] {
  const rows: ExtensionSummaryRow[] = [];
  const lines = sectionText.split(/\r?\n/);

  for (const line of lines) {
    const clean = line.trim();
    if (!clean.startsWith("CHEXT ")) {
      continue;
    }

    const match = clean.match(/^(CHEXT.+?)\s+([0-9.,]+)\s+([0-9.,]+)\s+([0-9.,]+)\s+(.+)$/);
    if (!match) {
      continue;
    }

    rows.push({
      key: match[1].trim(),
      required: parseTableNumber(match[2]),
      taken: parseTableNumber(match[3]),
      missing: parseTableNumber(match[4]),
      situation: match[5].trim()
    });
  }

  return rows;
}

function parseHeader(headerText: string): {
  student: ParsedTranscript["student"];
  matrixCode?: MatrixCode;
  matrixLabel?: string;
} {
  const student: ParsedTranscript["student"] = {};

  const alunoMatch = headerText.match(/Aluno:\s*([0-9]+)\s*-\s*([^\n]+?)\s+Identidade/i);
  if (alunoMatch) {
    student.registrationId = alunoMatch[1]?.trim();
    student.fullName = normalizeWhitespace(alunoMatch[2] ?? "");
  }

  const cursoMatch = headerText.match(/Curso:\s*([0-9]+)\s*-\s*([^\n]+?)\s+Per[ií]odo:\s*([^\n]+)/i);
  if (cursoMatch) {
    student.courseCode = cursoMatch[1]?.trim();
    student.courseName = normalizeWhitespace(cursoMatch[2] ?? "");
    student.period = normalizeWhitespace(cursoMatch[3] ?? "");
  }

  const ingressoMatch = headerText.match(/Ingresso:\s*([^\n]+?)\s+Data da cola[çc][aã]o/i);
  if (ingressoMatch) {
    student.entry = normalizeWhitespace(ingressoMatch[1] ?? "");
  }

  const matrixMatch = headerText.match(/Matriz:\s*(\d+)\s*-\s*([^\n]+)/i);
  const matrixCode = (matrixMatch?.[1] === "806" || matrixMatch?.[1] === "981"
    ? matrixMatch[1]
    : undefined) as MatrixCode | undefined;

  return {
    student,
    matrixCode,
    matrixLabel: matrixMatch ? normalizeWhitespace(matrixMatch[2] ?? "") : undefined
  };
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

async function runPdftotext(pdfPath: string): Promise<string> {
  const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"]);
  return stdout ?? "";
}

async function runPdfParseFallback(buffer: Buffer): Promise<string> {
  try {
    const mod = await import("pdf-parse");
    const ParserCtor = mod.PDFParse;
    if (typeof ParserCtor !== "function") {
      return "";
    }

    const parser = new ParserCtor({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed?.text ?? "";
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    }
  } catch {
    return "";
  }
}

async function runOcr(pdfPath: string): Promise<string> {
  const hasPdftoppm = await commandExists("pdftoppm");
  const hasTesseract = await commandExists("tesseract");
  if (!hasPdftoppm || !hasTesseract) {
    return "";
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "roadmap-ocr-"));
  try {
    const prefix = path.join(tempDir, "page");
    await execFileAsync("pdftoppm", ["-png", pdfPath, prefix]);

    const pageFiles = (await (await import("node:fs/promises")).readdir(tempDir))
      .filter((file) => file.endsWith(".png"))
      .sort();

    const chunks: string[] = [];
    for (const file of pageFiles) {
      const absolute = path.join(tempDir, file);
      const { stdout } = await execFileAsync("tesseract", [absolute, "stdout", "-l", "por"]);
      chunks.push(stdout ?? "");
    }

    return chunks.join("\n");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<ExtractTextResult> {
  const warnings: string[] = [];
  const tempDir = await mkdtemp(path.join(tmpdir(), "roadmap-pdf-"));
  const pdfPath = path.join(tempDir, "historico.pdf");

  try {
    await writeFile(pdfPath, buffer);

    let text = "";
    let usedOcr = false;

    if (await commandExists("pdftotext")) {
      try {
        text = await runPdftotext(pdfPath);
      } catch (error) {
        warnings.push(`Falha no pdftotext: ${(error as Error).message}`);
      }
    } else {
      warnings.push("pdftotext indisponível. Usando fallback em biblioteca JS.");
    }

    if (!text.trim()) {
      text = await runPdfParseFallback(buffer);
      if (!text.trim()) {
        warnings.push("Fallback de leitura JS indisponível para este PDF.");
      }
    }

    if (text.length < MIN_TEXT_SIZE_FOR_NO_OCR) {
      const ocrText = await runOcr(pdfPath);
      if (ocrText.trim().length > text.trim().length) {
        text = ocrText;
        usedOcr = true;
      } else if (!ocrText.trim()) {
        warnings.push("OCR não executado ou sem ganho de qualidade.");
      }
    }

    return { text, usedOcr, warnings };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function parseHistoricoText(rawText: string): ParsedTranscript {
  const text = rawText.replace(/\r\n/g, "\n");
  const sections = detectSections(text);
  const warnings: string[] = [];

  if (!sections.mandatory) {
    warnings.push("Seção de obrigatórias não encontrada.");
  }
  if (!sections.optional) {
    warnings.push("Seção de optativas não encontrada.");
  }

  const { student, matrixCode, matrixLabel } = parseHeader(sliceByRange(text, sections.header));

  const mandatoryParse = parseAttemptBlocks(sliceByRange(text, sections.mandatory), "mandatory");
  const optionalParse = parseAttemptBlocks(sliceByRange(text, sections.optional), "optional");
  const electiveParse = parseAttemptBlocks(sliceByRange(text, sections.elective), "elective");

  const attempts = [...mandatoryParse.attempts, ...optionalParse.attempts, ...electiveParse.attempts];

  const explicitMissing = parseMissingTable(sliceByRange(text, sections.explicitMissing), true);
  const dependencies = parseMissingTable(sliceByRange(text, sections.dependencies), false);
  const summary = parseSummaryTable(sliceByRange(text, sections.summary));
  const extensionSummary = parseExtensionSummary(sliceByRange(text, sections.extensionSummary));

  if (attempts.length === 0) {
    warnings.push("Nenhuma disciplina foi parseada automaticamente.");
  }

  return {
    parserVersion: PARSER_VERSION,
    generatedAt: new Date().toISOString(),
    rawText,
    student,
    detectedMatrixCode: matrixCode,
    matrixLabel,
    attempts,
    explicitMissing,
    dependencies,
    summary,
    extensionSummary,
    unparsedBlocks: [...mandatoryParse.unparsed, ...optionalParse.unparsed, ...electiveParse.unparsed],
    warnings
  };
}

export async function parseHistoricoPdfBuffer(buffer: Buffer): Promise<ParsedTranscript> {
  const extraction = await extractTextFromPdfBuffer(buffer);
  const parsed = parseHistoricoText(extraction.text);

  if (extraction.usedOcr) {
    parsed.warnings.push("OCR utilizado por baixa densidade de texto no PDF.");
  }
  parsed.warnings.push(...extraction.warnings);

  return parsed;
}

export async function parseHistoricoPdfFile(filePath: string): Promise<ParsedTranscript> {
  const buffer = await readFile(filePath);
  return parseHistoricoPdfBuffer(buffer);
}
