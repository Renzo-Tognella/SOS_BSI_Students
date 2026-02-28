import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
import { isSupportedMatrixCode } from "@/lib/domain/matrix-metadata";
import {
  normalizeDisciplineCode,
  normalizeStatus,
  normalizeWhitespace,
  parseIntSafe,
  parsePtNumber
} from "@/lib/utils/academic";
import { detectSections, sliceByRange } from "@/lib/parser/section-detectors";

const execFileAsync = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);
const MIN_TEXT_SIZE_FOR_NO_OCR = 3000;
const MIN_PARSE_SCORE_FOR_NO_OCR = 120;
const PARSER_VERSION = "1.1.0";

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

const ATTEMPT_ROW_START_REGEX = /^\s*(\d+)\s+([A-Z0-9]{4,8})\b/;
const ATTEMPT_TAIL_REGEX =
  /(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d+))?\s+([0-9*.,]+)(?:\s+([0-9*.,]+))?\s+([12])\s+(\d{4})(?:\s+(.*))?$/;
const ELECTIVE_NUMERIC_ROW_REGEX =
  /^\s*(\d+)\s+.*?\b([A-Z]{1,2}\d{2,3})\s+(\d+)\s+(\d+)\s+([0-9*.,]+)(?:\s+([0-9*.,]+))?\s+([12])\s+(\d{4})(?:\s+(.*))?$/;
const ELECTIVE_DETAIL_CODE_REGEX = /([A-Z]{2,4}\d[A-Z0-9]{1,4})\s*-\s*(.+)$/i;
const NAME_STATUS_BREAK_REGEX =
  /(aprovad|reprovad|cancelad|credito consignado|crédito consignado|sem conclusao|sem conclusão|obs\.?|doutorado|mestrado|equivalente|disciplina\s*\(|\[\s*disciplina|gerou convalida)/i;

function cleanNameFragment(raw: string): string {
  return normalizeWhitespace(raw)
    .replace(/^\d+\s+[A-Z0-9]{4,8}\s*/, "")
    .replace(/\bTurmas\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function firstNonEmptyColumn(raw: string): string {
  const trimmedStart = raw.trimStart();
  if (!trimmedStart) {
    return "";
  }
  const columns = trimmedStart.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
  return columns[0] ?? "";
}

function isLikelyNameFragment(raw: string): boolean {
  const fragment = cleanNameFragment(raw);
  if (!fragment || fragment.length < 3) {
    return false;
  }

  if (NAME_STATUS_BREAK_REGEX.test(fragment)) {
    return false;
  }

  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(fragment)) {
    return false;
  }

  if (/^\d+$/.test(fragment)) {
    return false;
  }

  if (/^(Per\.Disc\/Matriz|C[oó]d\.|Disciplina|Turma|Tipo|Semestre|Ano|Situa[çc][aã]o|Professor)/i.test(fragment)) {
    return false;
  }

  if (/(ministerio da educacao|universidade tecnologica federal|utfpr|detalhes das equivalentes|quadro resumo)/i.test(fragment)) {
    return false;
  }

  const digitCount = (fragment.match(/\d/g) ?? []).length;
  return digitCount <= 2;
}

function appendUniqueFragment(output: string[], fragment: string): void {
  if (!fragment) {
    return;
  }
  if (!output.includes(fragment)) {
    output.push(fragment);
  }
}

function inferNameFromContext(params: {
  lines: string[];
  blockLines: string[];
  start: number;
  previousStart: number;
  parsedName: string;
  fallbackCode: string;
}): string {
  const { lines, blockLines, start, previousStart, parsedName, fallbackCode } = params;

  const leading: string[] = [];
  for (let cursor = start - 1; cursor > previousStart; cursor -= 1) {
    const raw = lines[cursor] ?? "";
    if (!raw.trim()) {
      continue;
    }
    if (ATTEMPT_ROW_START_REGEX.test(raw)) {
      break;
    }

    const candidate = cleanNameFragment(firstNonEmptyColumn(raw));

    if (NAME_STATUS_BREAK_REGEX.test(candidate)) {
      if (leading.length > 0) {
        break;
      }
      continue;
    }

    if (isLikelyNameFragment(candidate)) {
      leading.unshift(candidate);
      if (leading.length >= 2) {
        break;
      }
      continue;
    }

    if (leading.length > 0) {
      break;
    }
  }

  const trailing: string[] = [];
  for (const raw of blockLines.slice(1)) {
    if (!raw.trim()) {
      continue;
    }
    const candidate = cleanNameFragment(firstNonEmptyColumn(raw));
    if (NAME_STATUS_BREAK_REGEX.test(candidate)) {
      break;
    }
    if (isLikelyNameFragment(candidate)) {
      appendUniqueFragment(trailing, candidate);
      if (trailing.length >= 3) {
        break;
      }
      continue;
    }
    if (trailing.length > 0) {
      break;
    }
  }

  const fragments: string[] = [];
  leading.forEach((fragment) => appendUniqueFragment(fragments, fragment));
  appendUniqueFragment(fragments, cleanNameFragment(parsedName));
  trailing.forEach((fragment) => appendUniqueFragment(fragments, fragment));

  return sanitizeName(fragments.join(" "), fallbackCode);
}

function parseAttemptBlocks(sectionText: string, sourceSection: TranscriptSection): { attempts: TranscriptAttempt[]; unparsed: string[] } {
  const lines = sectionText.split(/\r?\n/);
  const starts: number[] = [];

  lines.forEach((line, index) => {
    if (ATTEMPT_ROW_START_REGEX.test(line)) {
      starts.push(index);
    }
  });

  const attempts: TranscriptAttempt[] = [];
  const unparsed: string[] = [];

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const previousStart = i > 0 ? starts[i - 1] : -1;
    const blockLines = lines.slice(start, end);
    const rowLine = blockLines[0] ?? "";
    const headMatch = rowLine.match(ATTEMPT_ROW_START_REGEX);
    if (!headMatch) {
      unparsed.push(blockLines.join("\n"));
      continue;
    }

    const periodInMatrix = parseIntSafe(headMatch[1]);
    const code = normalizeDisciplineCode(headMatch[2]);

    const tailMatch = rowLine.match(ATTEMPT_TAIL_REGEX);
    if (!tailMatch) {
      unparsed.push(blockLines.join("\n"));
      continue;
    }

    const [, chsRaw, chtRaw, chextRaw, , avgRaw, freqRaw, semRaw, yearRaw, statusTailRaw] = tailMatch;
    const fullTail = rowLine.slice(rowLine.length - tailMatch[0].length);
    const prefix = rowLine.slice(0, rowLine.length - fullTail.length).trim();

    const prefixWithoutPeriodCode = prefix.replace(/^\d+\s+[A-Z0-9]{4,8}\s*/, "").trim();
    const tokens = prefixWithoutPeriodCode.split(/\s+/).filter(Boolean);

    const classCode = tokens.find((token) => /^[A-Z]{1,2}\d{2,3}$/.test(token));
    const type = tokens.find((token) => /^[RFEDSI]$/.test(token));

    const nameTokens = tokens.filter((token) => token !== classCode && token !== type);
    const parsedName = cleanNameFragment(nameTokens.join(" "));
    const joinedBlock = blockLines.join("\n");
    const statusText = normalizeWhitespace([statusTailRaw ?? "", joinedBlock].join(" "));
    const average = parsePtNumber(avgRaw);
    const frequency = parsePtNumber(freqRaw);
    const inferredName = inferNameFromContext({
      lines,
      blockLines,
      start,
      previousStart,
      parsedName,
      fallbackCode: code
    });

    attempts.push({
      sourceSection,
      periodInMatrix,
      code,
      normalizedCode: code,
      name: inferredName,
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

function parseElectiveAttempts(sectionText: string): { attempts: TranscriptAttempt[]; unparsed: string[] } {
  const lines = sectionText.split(/\r?\n/);
  const rowIndexes: number[] = [];

  lines.forEach((line, index) => {
    if (ELECTIVE_NUMERIC_ROW_REGEX.test(line)) {
      rowIndexes.push(index);
    }
  });

  const attempts: TranscriptAttempt[] = [];
  const unparsed: string[] = [];

  for (let i = 0; i < rowIndexes.length; i += 1) {
    const rowIndex = rowIndexes[i];
    const blockStart = i > 0 ? rowIndexes[i - 1] + 1 : 0;
    const blockEnd = i + 1 < rowIndexes.length ? rowIndexes[i + 1] : lines.length;
    const contextStart = Math.max(blockStart, rowIndex - 6);
    const contextLines = lines.slice(contextStart, blockEnd);
    const rowLine = lines[rowIndex] ?? "";
    const rowMatch = rowLine.match(ELECTIVE_NUMERIC_ROW_REGEX);

    if (!rowMatch) {
      unparsed.push(contextLines.join("\n"));
      continue;
    }

    const [, periodRaw, classRaw, chtRaw, chextRaw, avgRaw, freqRaw, semRaw, yearRaw, statusTailRaw] = rowMatch;

    let code = "";
    const nameFragments: string[] = [];
    let codeLineIndex = -1;

    for (let cursor = rowIndex; cursor >= contextStart; cursor -= 1) {
      const currentLine = lines[cursor] ?? "";
      const codeMatch = currentLine.match(ELECTIVE_DETAIL_CODE_REGEX);
      if (!codeMatch) {
        continue;
      }

      code = normalizeDisciplineCode(codeMatch[1]);
      appendUniqueFragment(nameFragments, cleanNameFragment(codeMatch[2] ?? ""));
      codeLineIndex = cursor;
      break;
    }

    if (!code) {
      unparsed.push(contextLines.join("\n"));
      continue;
    }

    if (codeLineIndex !== -1) {
      for (let cursor = codeLineIndex + 1; cursor < rowIndex; cursor += 1) {
        const fragment = cleanNameFragment(lines[cursor] ?? "");
        if (isLikelyNameFragment(fragment)) {
          appendUniqueFragment(nameFragments, fragment);
        }
      }
    }

    for (let cursor = rowIndex + 1; cursor < blockEnd; cursor += 1) {
      const raw = lines[cursor] ?? "";
      if (!raw.trim()) {
        continue;
      }
      if (NAME_STATUS_BREAK_REGEX.test(raw)) {
        break;
      }
      const fragment = cleanNameFragment(raw);
      if (isLikelyNameFragment(fragment)) {
        appendUniqueFragment(nameFragments, fragment);
        if (nameFragments.length >= 4) {
          break;
        }
      }
    }

    const cht = parseIntSafe(chtRaw) ?? 0;
    const average = parsePtNumber(avgRaw);
    const frequency = parsePtNumber(freqRaw);
    const statusText = normalizeWhitespace([statusTailRaw ?? "", ...contextLines].join(" "));

    attempts.push({
      sourceSection: "elective",
      periodInMatrix: parseIntSafe(periodRaw),
      code,
      normalizedCode: code,
      name: sanitizeName(nameFragments.join(" "), code),
      classCode: classRaw,
      chs: Math.max(1, Math.round(cht / 15)),
      cht,
      chext: parseIntSafe(chextRaw) ?? 0,
      average,
      frequency,
      semester: parseIntSafe(semRaw) ?? null,
      year: parseIntSafe(yearRaw) ?? null,
      status: normalizeStatus(statusText, { average, frequency }),
      statusText,
      rawBlock: contextLines.join("\n")
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
  const matrixCode = isSupportedMatrixCode(matrixMatch?.[1]) ? (matrixMatch[1] as MatrixCode) : undefined;

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
  const tryExtractText = async (PDFParseCtor: unknown): Promise<string> => {
    if (typeof PDFParseCtor !== "function") {
      return "";
    }

    const parser = new (PDFParseCtor as new (options: { data: Buffer }) => { getText: () => Promise<{ text?: string }>; destroy?: () => Promise<void> | void })({
      data: buffer
    });

    try {
      const parsed = await parser.getText();
      return parsed?.text ?? "";
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    }
  };

  try {
    // Prefer CommonJS loader in Node runtime to avoid browser-conditioned exports in serverless bundles.
    const mod = requireFromHere("pdf-parse") as { PDFParse?: unknown };
    const text = await tryExtractText(mod?.PDFParse);
    if (text.trim()) {
      return text;
    }
  } catch {
    // Ignore and try dynamic import fallback below.
  }

  try {
    const mod = (await import("pdf-parse")) as { PDFParse?: unknown };
    return await tryExtractText(mod?.PDFParse);
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

function scoreExtractedTextQuality(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = parseHistoricoText(trimmed);
  const blankNames = parsed.attempts.filter((attempt) => {
    const cleanedName = (attempt.name ?? "").trim();
    if (!cleanedName) {
      return true;
    }
    if (cleanedName === attempt.code) {
      return true;
    }
    return /^\d+$/.test(cleanedName);
  }).length;

  let score = 0;
  score += parsed.attempts.length * 6;
  score += parsed.explicitMissing.length * 2;
  score += parsed.summary.length * 2;
  score += parsed.extensionSummary.length;
  score -= parsed.unparsedBlocks.length * 8;
  score -= blankNames * 3;

  if (parsed.detectedMatrixCode) {
    score += 15;
  }
  if (parsed.attempts.some((attempt) => attempt.sourceSection === "elective")) {
    score += 12;
  }

  return score;
}

export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<ExtractTextResult> {
  const warnings: string[] = [];
  const tempDir = await mkdtemp(path.join(tmpdir(), "roadmap-pdf-"));
  const pdfPath = path.join(tempDir, "historico.pdf");

  try {
    await writeFile(pdfPath, buffer);

    let primaryText = "";
    let usedOcr = false;

    if (await commandExists("pdftotext")) {
      try {
        primaryText = await runPdftotext(pdfPath);
      } catch (error) {
        warnings.push(`Falha no pdftotext: ${(error as Error).message}`);
      }
    } else {
      warnings.push("pdftotext indisponível. Usando fallback em biblioteca JS.");
    }

    if (!primaryText.trim()) {
      primaryText = await runPdfParseFallback(buffer);
      if (!primaryText.trim()) {
        warnings.push("Fallback de leitura JS indisponível para este PDF.");
      }
    }

    let bestText = primaryText;
    let bestScore = scoreExtractedTextQuality(bestText);

    const shouldTryOcr =
      bestText.trim().length === 0 || bestText.length < MIN_TEXT_SIZE_FOR_NO_OCR || bestScore < MIN_PARSE_SCORE_FOR_NO_OCR;

    if (shouldTryOcr) {
      const hasPdftoppm = await commandExists("pdftoppm");
      const hasTesseract = await commandExists("tesseract");

      if (!hasPdftoppm || !hasTesseract) {
        warnings.push("OCR indisponível (pdftoppm/tesseract não encontrados).");
      } else {
        const ocrText = await runOcr(pdfPath);
        if (!ocrText.trim()) {
          warnings.push("OCR executado sem retorno de texto.");
        } else {
          const ocrScore = scoreExtractedTextQuality(ocrText);
          if (ocrScore > bestScore + 2) {
            bestText = ocrText;
            bestScore = ocrScore;
            usedOcr = true;
          } else {
            warnings.push("OCR executado sem ganho de qualidade no parse.");
          }
        }
      }
    }

    if (!bestText.trim()) {
      warnings.push("Nenhum texto pôde ser extraído do PDF.");
    }

    return { text: bestText, usedOcr, warnings };
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
  const electiveParse = parseElectiveAttempts(sliceByRange(text, sections.elective));

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
