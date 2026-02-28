import { readFile } from "node:fs/promises";
import path from "node:path";

import { readEmbeddedJson } from "@/lib/domain/embedded-data";
import { loadMatrixCatalogByCode } from "@/lib/domain/matrix-catalog";
import { buildPrereqGraph } from "@/lib/domain/prereq-graph";
import { disciplineNamesLikelyMatch, normalizeDisciplineCode, normalizeDisciplineNameForComparison } from "@/lib/utils/academic";
import type {
  CorrelationSuggestion,
  CurriculumMatrix,
  DisciplineCategory,
  ElectiveOption,
  EquivalenceRule,
  ManualCorrelationInput,
  MatrixCatalogDiscipline,
  MatrixCode,
  ParsedTranscript,
  PendingDiscipline,
  PrereqGraphNode,
  ProgressBucket,
  RoadmapResult,
  TranscriptAttempt,
  UnmatchedApprovedAttempt,
  UnusedDiscipline
} from "@/types/academic";

interface DerivedAttempt extends TranscriptAttempt {
  targetCode: string;
  sourceCode: string;
}

interface NameMatchResult {
  sourceCode: string;
  targetCode: string;
  sourceName: string;
  targetName: string;
}

interface ConservativeNameMatchResult extends NameMatchResult {
  score: number;
}

interface RawConvalidationMatch {
  code: string;
  reason: string;
}

interface ManualMatchResult {
  sourceCode: string;
  targetCode?: string;
  sourceName: string;
  targetName?: string;
  targetCategory: DisciplineCategory;
  creditedCHT: number;
  manualOnly: boolean;
}

interface ManualCorrelationOutcome {
  matches: ManualMatchResult[];
  creditedByCategory: Record<DisciplineCategory, number>;
}

interface MatrixCapability {
  hasMandatory: boolean;
  hasOptional: boolean;
  hasTrack: boolean;
  hasElective: boolean;
  hasComplementary: boolean;
  hasInternship: boolean;
  hasTcc: boolean;
  hasExtension: boolean;
}

const SYNTHETIC_ELECTIVE_PENDING_PREFIX = "ELVP";
const SYNTHETIC_ELECTIVE_DONE_PREFIX = "ELVD";
const SYNTHETIC_ELECTIVE_DEFAULT_PERIOD = 8;
const SYNTHETIC_ELECTIVE_UNIT_CHT = 15;
const CATALOG_ELECTIVE_GROUPS = new Set(["1171"]);

function isEngComp844To962Migration(parsed: ParsedTranscript, matrixCode: MatrixCode): boolean {
  return parsed.detectedMatrixCode === "844" && matrixCode === "962";
}

async function readJsonFromRoot<T>(relativePath: string): Promise<T> {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  const rootsToTry = [process.cwd(), path.join(process.cwd(), ".next", "server"), path.join(process.cwd(), ".next", "standalone")];

  let lastNotFoundError: unknown;
  for (const root of rootsToTry) {
    const absolute = path.join(root, normalizedPath);
    try {
      const payload = await readFile(absolute, "utf8");
      return JSON.parse(payload) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      lastNotFoundError = error;
    }
  }

  const embedded = readEmbeddedJson<T>(normalizedPath);
  if (embedded) {
    return embedded;
  }

  throw (
    lastNotFoundError ??
    new Error(`Arquivo JSON não encontrado para leitura: ${normalizedPath}`)
  );
}

export async function loadCurriculumMatrix(matrixCode: MatrixCode): Promise<CurriculumMatrix> {
  return readJsonFromRoot<CurriculumMatrix>(`data/matrizes/${matrixCode}.json`);
}

export async function loadEquivalenceRules(targetMatrixCode: MatrixCode): Promise<EquivalenceRule[]> {
  const fileByTarget: Partial<Record<MatrixCode, string>> = {
    "981": "data/matrizes/equivalencias_806_981.json",
    "962": "data/matrizes/equivalencias_844_962.json"
  };

  const relativePath = fileByTarget[targetMatrixCode];
  if (!relativePath) {
    return [];
  }

  return readJsonFromRoot<EquivalenceRule[]>(relativePath);
}

function extractConvalidationTargets(statusText: string): string[] {
  const targets: string[] = [];
  const regex = /Gerou Convalida[çc][aã]o\s*-\s*Disc\.:\s*([A-Z0-9]+)/gi;
  let match = regex.exec(statusText);
  while (match) {
    targets.push(normalizeDisciplineCode(match[1]));
    match = regex.exec(statusText);
  }
  return targets;
}

function deriveAttempts(
  attempts: TranscriptAttempt[],
  rules: EquivalenceRule[]
): DerivedAttempt[] {
  const ruleMap = new Map<string, EquivalenceRule>();
  for (const rule of rules) {
    ruleMap.set(normalizeDisciplineCode(rule.fromCode), {
      ...rule,
      fromCode: normalizeDisciplineCode(rule.fromCode),
      toCodes: rule.toCodes.map((code) => normalizeDisciplineCode(code))
    });
  }

  const output: DerivedAttempt[] = [];
  for (const attempt of attempts) {
    const sourceCode = normalizeDisciplineCode(attempt.code);
    const targets = new Set<string>([sourceCode]);

    const rule = ruleMap.get(sourceCode);
    if (rule) {
      for (const target of rule.toCodes) {
        targets.add(target);
      }
    }

    for (const target of extractConvalidationTargets(attempt.statusText)) {
      targets.add(target);
    }

    for (const targetCode of targets) {
      output.push({
        ...attempt,
        sourceCode,
        targetCode,
        normalizedCode: targetCode
      });
    }
  }

  return output;
}

function chooseBestAttempt(current: DerivedAttempt | undefined, next: DerivedAttempt): DerivedAttempt {
  if (!current) {
    return next;
  }

  if (next.status === "APPROVED" && current.status !== "APPROVED") {
    return next;
  }
  if (next.status !== "APPROVED" && current.status === "APPROVED") {
    return current;
  }

  const currentYear = current.year ?? 0;
  const nextYear = next.year ?? 0;
  const currentSem = current.semester ?? 0;
  const nextSem = next.semester ?? 0;

  if (nextYear > currentYear) {
    return next;
  }
  if (nextYear === currentYear && nextSem >= currentSem) {
    return next;
  }

  return current;
}

function chooseNameMatchCandidate(
  candidates: CurriculumMatrix["disciplines"],
  completedCodes: Set<string>,
  sourceName: string
): CurriculumMatrix["disciplines"][number] | undefined {
  const available = candidates.filter((discipline) => !completedCodes.has(discipline.code));
  if (available.length === 0) {
    return undefined;
  }

  const sourceNormalized = normalizeDisciplineNameForComparison(sourceName);
  const exact = available.find((discipline) => normalizeDisciplineNameForComparison(discipline.name) === sourceNormalized);
  if (exact) {
    return exact;
  }

  return [...available].sort((a, b) => (a.recommendedPeriod ?? 99) - (b.recommendedPeriod ?? 99) || a.code.localeCompare(b.code))[0];
}

function applyNameFallbackMatches(params: {
  matrix: CurriculumMatrix;
  attempts: TranscriptAttempt[];
  completedCodes: Set<string>;
  completedSourceCodes: Set<string>;
}): NameMatchResult[] {
  const { matrix, attempts, completedCodes, completedSourceCodes } = params;

  const matrixByNormalizedName = new Map<string, CurriculumMatrix["disciplines"]>();
  for (const discipline of matrix.disciplines) {
    const normalizedName = normalizeDisciplineNameForComparison(discipline.name);
    if (!normalizedName) {
      continue;
    }
    const current = matrixByNormalizedName.get(normalizedName) ?? [];
    current.push(discipline);
    matrixByNormalizedName.set(normalizedName, current);
  }

  const approvedAttempts = attempts
    .filter((attempt) => attempt.status === "APPROVED")
    .sort((a, b) => {
      const yearDiff = (b.year ?? 0) - (a.year ?? 0);
      if (yearDiff !== 0) {
        return yearDiff;
      }
      return (b.semester ?? 0) - (a.semester ?? 0);
    });

  const matches: NameMatchResult[] = [];

  for (const attempt of approvedAttempts) {
    const sourceCode = normalizeDisciplineCode(attempt.code);
    if (completedSourceCodes.has(sourceCode)) {
      continue;
    }

    const attemptName = attempt.name?.trim();
    if (!attemptName) {
      continue;
    }

    const directCandidates = matrixByNormalizedName.get(normalizeDisciplineNameForComparison(attemptName)) ?? [];
    let candidate = chooseNameMatchCandidate(directCandidates, completedCodes, attemptName);

    if (!candidate) {
      const fuzzyCandidates = matrix.disciplines.filter((discipline) => disciplineNamesLikelyMatch(attemptName, discipline.name));
      candidate = chooseNameMatchCandidate(fuzzyCandidates, completedCodes, attemptName);
    }

    if (!candidate) {
      continue;
    }

    completedCodes.add(candidate.code);
    completedSourceCodes.add(sourceCode);
    matches.push({
      sourceCode,
      targetCode: candidate.code,
      sourceName: attemptName,
      targetName: candidate.name
    });
  }

  return matches;
}

function applyManualCorrelationMatches(params: {
  matrix: CurriculumMatrix;
  attempts: TranscriptAttempt[];
  completedCodes: Set<string>;
  completedSourceCodes: Set<string>;
  manualMappings?: ManualCorrelationInput[];
}): ManualCorrelationOutcome {
  const { matrix, attempts, completedCodes, completedSourceCodes, manualMappings = [] } = params;
  const creditedByCategory: Record<DisciplineCategory, number> = {
    MANDATORY: 0,
    OPTIONAL: 0,
    TRACK: 0,
    ELECTIVE: 0,
    COMPLEMENTARY: 0,
    INTERNSHIP: 0,
    TCC: 0,
    UNKNOWN: 0
  };

  if (!Array.isArray(manualMappings) || manualMappings.length === 0) {
    return { matches: [], creditedByCategory };
  }

  const matrixByCode = new Map(matrix.disciplines.map((discipline) => [normalizeDisciplineCode(discipline.code), discipline]));
  const mappingBySourceCode = new Map<string, ManualCorrelationInput>();
  const mappingBySourceName = new Map<string, ManualCorrelationInput>();

  for (const mapping of manualMappings) {
    const sourceCode = normalizeDisciplineCode(mapping.sourceCode ?? "");
    const sourceName = normalizeDisciplineNameForComparison(mapping.sourceName ?? "");
    const targetCode = normalizeDisciplineCode(mapping.targetCode ?? "");
    const hasCustomName = (mapping.customDisciplineName ?? "").trim().length > 0;
    const hasCreditedHours = Number.isFinite(mapping.creditedCHT);
    const isManualOnly = Boolean(mapping.manualOnly);
    const hasAnyRouting =
      isManualOnly ||
      hasCreditedHours ||
      Boolean(mapping.targetCategory) ||
      hasCustomName ||
      Boolean(mapping.customDisciplineCode) ||
      Boolean(targetCode);

    if (!hasAnyRouting) {
      continue;
    }

    const normalizedMapping: ManualCorrelationInput = {
      ...mapping,
      sourceCode: sourceCode || mapping.sourceCode,
      sourceName: mapping.sourceName,
      targetCode: targetCode || mapping.targetCode
    };

    if (sourceCode) {
      mappingBySourceCode.set(sourceCode, normalizedMapping);
    }
    if (sourceName) {
      mappingBySourceName.set(sourceName, normalizedMapping);
    }
  }

  const approvedAttempts = attempts
    .filter((attempt) => attempt.status === "APPROVED")
    .sort((a, b) => {
      const yearDiff = (b.year ?? 0) - (a.year ?? 0);
      if (yearDiff !== 0) {
        return yearDiff;
      }
      return (b.semester ?? 0) - (a.semester ?? 0);
    });

  const matches: ManualMatchResult[] = [];

  for (const attempt of approvedAttempts) {
    const sourceCode = normalizeDisciplineCode(attempt.code);
    if (!sourceCode || completedSourceCodes.has(sourceCode)) {
      continue;
    }

    const sourceName = attempt.name?.trim() ?? sourceCode;
    const normalizedName = normalizeDisciplineNameForComparison(sourceName);
    const mapping = mappingBySourceCode.get(sourceCode) ?? (normalizedName ? mappingBySourceName.get(normalizedName) : undefined);
    if (!mapping) {
      continue;
    }

    const targetCode = normalizeDisciplineCode(mapping.targetCode ?? "");
    const targetDiscipline = targetCode ? matrixByCode.get(targetCode) : undefined;
    const manualOnly = Boolean(mapping.manualOnly);
    if (!manualOnly && !targetDiscipline) {
      continue;
    }

    const targetCategory: DisciplineCategory =
      mapping.targetCategory ??
      targetDiscipline?.category ??
      "UNKNOWN";

    const creditedCHTBase = Number.isFinite(mapping.creditedCHT) ? Number(mapping.creditedCHT) : Math.max(attempt.cht ?? 0, 0);
    const creditedCHT = Math.max(Math.round(creditedCHTBase), 0);
    if (creditedCHT <= 0) {
      continue;
    }

    completedSourceCodes.add(sourceCode);
    creditedByCategory[targetCategory] = (creditedByCategory[targetCategory] ?? 0) + creditedCHT;

    if (!manualOnly && targetDiscipline && targetCategory === targetDiscipline.category && creditedCHT >= targetDiscipline.cht) {
      completedCodes.add(targetDiscipline.code);
    }

    matches.push({
      sourceCode,
      sourceName,
      targetCode: targetDiscipline?.code,
      targetName: mapping.customDisciplineName?.trim() || targetDiscipline?.name,
      targetCategory,
      creditedCHT,
      manualOnly
    });
  }

  return { matches, creditedByCategory };
}

function buildUnmatchedApprovedAttempts(params: {
  matrix: CurriculumMatrix;
  rules: EquivalenceRule[];
  completedCodes: Set<string>;
  completedSourceCodes: Set<string>;
  completedAttempts: TranscriptAttempt[];
}): UnmatchedApprovedAttempt[] {
  const { matrix, rules, completedCodes, completedSourceCodes, completedAttempts } = params;
  const matrixCandidates = matrix.disciplines
    .filter((discipline) => !completedCodes.has(discipline.code))
    .sort((a, b) => (a.recommendedPeriod ?? 99) - (b.recommendedPeriod ?? 99) || a.code.localeCompare(b.code));
  const matrixByCode = new Map(matrix.disciplines.map((discipline) => [normalizeDisciplineCode(discipline.code), discipline]));
  const rulesBySourceCode = new Map<string, string[]>();
  for (const rule of rules) {
    const sourceCode = normalizeDisciplineCode(rule.fromCode);
    const targets = (rule.toCodes ?? []).map((code) => normalizeDisciplineCode(code)).filter(Boolean);
    if (!sourceCode || targets.length === 0) {
      continue;
    }
    rulesBySourceCode.set(sourceCode, targets);
  }

  const attempts = completedAttempts
    .slice()
    .sort((a, b) => {
      const yearDiff = (b.year ?? 0) - (a.year ?? 0);
      if (yearDiff !== 0) {
        return yearDiff;
      }
      return (b.semester ?? 0) - (a.semester ?? 0);
    });

  const output: UnmatchedApprovedAttempt[] = [];
  const seenSourceCodes = new Set<string>();

  for (const attempt of attempts) {
    const sourceCode = normalizeDisciplineCode(attempt.code);
    if (!sourceCode || seenSourceCodes.has(sourceCode) || completedSourceCodes.has(sourceCode)) {
      continue;
    }
    seenSourceCodes.add(sourceCode);

    const sourceName = attempt.name?.trim() || sourceCode;
    const suggestions: CorrelationSuggestion[] = [];
    const seenTargets = new Set<string>();

    const equivalenceTargets = rulesBySourceCode.get(sourceCode) ?? [];
    for (const targetCode of equivalenceTargets) {
      const target = matrixByCode.get(targetCode);
      if (!target || completedCodes.has(target.code) || seenTargets.has(target.code)) {
        continue;
      }
      suggestions.push({
        code: target.code,
        name: target.name,
        strategy: "EQUIVALENCE"
      });
      seenTargets.add(target.code);
    }

    for (const discipline of matrixCandidates) {
      if (seenTargets.has(discipline.code)) {
        continue;
      }
      if (normalizeDisciplineCode(discipline.code) === sourceCode) {
        suggestions.push({
          code: discipline.code,
          name: discipline.name,
          strategy: "CODE"
        });
        seenTargets.add(discipline.code);
      }
    }

    for (const discipline of matrixCandidates) {
      if (seenTargets.has(discipline.code)) {
        continue;
      }
      if (disciplineNamesLikelyMatch(sourceName, discipline.name)) {
        suggestions.push({
          code: discipline.code,
          name: discipline.name,
          strategy: "NAME"
        });
        seenTargets.add(discipline.code);
      }
    }

    output.push({
      sourceCode,
      sourceName,
      sourceSection: attempt.sourceSection,
      cht: attempt.cht,
      year: attempt.year ?? null,
      semester: attempt.semester ?? null,
      suggestedTargets: suggestions.slice(0, 8)
    });
  }

  return output;
}

function extractApprovedConvalidationCodes(rawText: string): RawConvalidationMatch[] {
  const normalized = rawText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

  const matches = new Map<string, RawConvalidationMatch>();

  function scan(regex: RegExp, reason: string): void {
    let found = regex.exec(normalized);
    while (found) {
      const rawCode = found[1]?.toUpperCase() ?? "";
      const code = normalizeDisciplineCode(rawCode);
      if (code) {
        const start = Math.max(0, found.index - 320);
        const end = Math.min(normalized.length, found.index + 320);
        const context = normalized.slice(start, end);
        const hasApprovalSignal =
          context.includes("credito consignado") ||
          context.includes("aprovado por nota") ||
          context.includes("aprovado por nota/frequencia") ||
          context.includes("aprovado");
        const hasEquivalenceSignal =
          context.includes("equivalente(s)") ||
          context.includes("cursou disciplina(s)") ||
          context.includes("gerou convalidacao");
        const reasonNeedsEquivalence = reason.includes("equivalência");
        if (hasApprovalSignal && (!reasonNeedsEquivalence || hasEquivalenceSignal)) {
          matches.set(code, { code, reason });
        }
      }
      found = regex.exec(normalized);
    }
  }

  scan(/gerou convalidacao\s*-\s*disc\.\s*:\s*([a-z0-9]{4,8})/gi, "Gerou Convalidação");
  scan(/\[disciplina\s+([a-z0-9]{4,8})/gi, "Crédito consignado por equivalência");

  return [...matches.values()];
}

function makeBucket(
  key: ProgressBucket["key"],
  label: string,
  requiredCHT: number,
  completedCHT: number,
  validatedCHT = completedCHT
): ProgressBucket {
  return {
    key,
    label,
    requiredCHT,
    completedCHT,
    validatedCHT,
    missingCHT: Math.max(requiredCHT - validatedCHT, 0)
  };
}

function sumCHTByCategory(
  matrix: CurriculumMatrix,
  completedCodes: Set<string>,
  categories: DisciplineCategory[]
): number {
  return matrix.disciplines
    .filter((discipline) => categories.includes(discipline.category) && completedCodes.has(discipline.code))
    .reduce((sum, discipline) => sum + discipline.cht, 0);
}

function inferMatrixCapability(matrix: CurriculumMatrix): MatrixCapability {
  const matrixCategories = new Set(matrix.disciplines.map((discipline) => discipline.category));
  const hasCategory = (category: DisciplineCategory): boolean => matrixCategories.has(category);

  return {
    hasMandatory: matrix.totals.mandatoryCHT > 0 || hasCategory("MANDATORY"),
    hasOptional: matrix.totals.optionalCHT > 0 || hasCategory("OPTIONAL") || hasCategory("TRACK"),
    hasTrack: hasCategory("TRACK"),
    hasElective: matrix.totals.electiveCHT > 0 || hasCategory("ELECTIVE"),
    hasComplementary: matrix.totals.complementaryCHT > 0 || hasCategory("COMPLEMENTARY"),
    hasInternship: matrix.totals.internshipCHT > 0 || hasCategory("INTERNSHIP"),
    hasTcc: matrix.totals.tccCHT > 0 || hasCategory("TCC"),
    hasExtension: matrix.totals.extensionCHT > 0
  };
}

function getExtensionTaken(parsed: ParsedTranscript): number {
  const row = parsed.extensionSummary.find((item) => item.key.toLowerCase().includes("geral"));
  return row?.taken ?? 0;
}

function isLikelySectionCategoryMatch(sourceSection: TranscriptAttempt["sourceSection"], targetCategory: DisciplineCategory): boolean {
  if (sourceSection === "mandatory") {
    return targetCategory === "MANDATORY";
  }
  if (sourceSection === "optional") {
    return targetCategory === "OPTIONAL" || targetCategory === "TRACK";
  }
  if (sourceSection === "elective") {
    return targetCategory === "ELECTIVE" || targetCategory === "OPTIONAL" || targetCategory === "TRACK";
  }
  return true;
}

function evaluateConservativeNameMatchScore(params: {
  source: TranscriptAttempt;
  target: CurriculumMatrix["disciplines"][number];
}): number {
  const { source, target } = params;
  const sourceName = source.name?.trim() ?? "";
  const targetName = target.name?.trim() ?? "";
  if (!sourceName || !targetName) {
    return Number.NEGATIVE_INFINITY;
  }

  const sourceNormalized = normalizeDisciplineNameForComparison(sourceName);
  const targetNormalized = normalizeDisciplineNameForComparison(targetName);
  if (!sourceNormalized || !targetNormalized) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = Number.NEGATIVE_INFINITY;
  if (sourceNormalized === targetNormalized) {
    score = 100;
  } else if (disciplineNamesLikelyMatch(sourceName, targetName)) {
    score = 75;
  }

  if (!Number.isFinite(score)) {
    return Number.NEGATIVE_INFINITY;
  }

  if (!isLikelySectionCategoryMatch(source.sourceSection, target.category)) {
    return Number.NEGATIVE_INFINITY;
  }
  score += 12;

  if (source.cht > 0 && target.cht > 0) {
    if (source.cht === target.cht) {
      score += 10;
    } else if (Math.abs(source.cht - target.cht) <= 15) {
      score += 4;
    } else {
      score -= 6;
    }
  }

  return score;
}

function applyConservativeNameInferenceForEngComp(params: {
  matrix: CurriculumMatrix;
  attempts: TranscriptAttempt[];
  completedCodes: Set<string>;
  completedSourceCodes: Set<string>;
  rules: EquivalenceRule[];
}): ConservativeNameMatchResult[] {
  const { matrix, attempts, completedCodes, completedSourceCodes, rules } = params;
  const sourceCodesWithOfficialRule = new Set(rules.map((rule) => normalizeDisciplineCode(rule.fromCode)));

  const approvedAttempts = attempts
    .filter((attempt) => attempt.status === "APPROVED")
    .sort((a, b) => {
      const yearDiff = (b.year ?? 0) - (a.year ?? 0);
      if (yearDiff !== 0) {
        return yearDiff;
      }
      return (b.semester ?? 0) - (a.semester ?? 0);
    });

  const matches: ConservativeNameMatchResult[] = [];

  for (const attempt of approvedAttempts) {
    const sourceCode = normalizeDisciplineCode(attempt.code);
    if (!sourceCode || completedSourceCodes.has(sourceCode) || sourceCodesWithOfficialRule.has(sourceCode)) {
      continue;
    }

    const sourceName = attempt.name?.trim();
    if (!sourceName || sourceName === sourceCode) {
      continue;
    }

    const candidates = matrix.disciplines
      .filter((discipline) => !completedCodes.has(discipline.code))
      .map((discipline) => ({
        discipline,
        score: evaluateConservativeNameMatchScore({ source: attempt, target: discipline })
      }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score || (a.discipline.recommendedPeriod ?? 99) - (b.discipline.recommendedPeriod ?? 99));

    if (candidates.length === 0) {
      continue;
    }

    const strongest = candidates[0];
    const secondStrongest = candidates[1];
    const hasStrongCandidate = strongest.score >= 95;
    const hasAmbiguity = secondStrongest ? strongest.score - secondStrongest.score < 8 : false;
    if (!hasStrongCandidate || hasAmbiguity) {
      continue;
    }

    completedCodes.add(strongest.discipline.code);
    completedSourceCodes.add(sourceCode);
    matches.push({
      sourceCode,
      targetCode: strongest.discipline.code,
      sourceName,
      targetName: strongest.discipline.name,
      score: strongest.score
    });
  }

  return matches;
}

function getSummaryValue(
  parsed: ParsedTranscript,
  rowNeedle: string,
  key: "approvedOrValidated" | "taken" | "missing" | "approvedByStudent"
): number | undefined {
  const row = parsed.summary.find((item) => item.key.toLowerCase().includes(rowNeedle.toLowerCase()));
  return row?.[key] as number | undefined;
}

function splitSyntheticElectiveUnits(totalCht: number): number[] {
  const normalizedTotal = Math.max(Math.floor(totalCht), 0);
  const units: number[] = [];
  let remaining = normalizedTotal;

  while (remaining > 0) {
    const nextUnit = Math.min(SYNTHETIC_ELECTIVE_UNIT_CHT, remaining);
    units.push(nextUnit);
    remaining -= nextUnit;
  }

  return units;
}

function formatSyntheticElectiveCode(prefix: string, index: number, cht: number): string {
  return `${prefix}${String(index).padStart(3, "0")}C${String(Math.max(Math.floor(cht), 0)).padStart(3, "0")}`;
}

function buildSyntheticElectiveData(params: {
  matrix: CurriculumMatrix;
  electiveCompleted: number;
  electiveValidated: number;
}): {
  pending: PendingDiscipline[];
  nodes: PrereqGraphNode[];
  alerts: string[];
} {
  const { matrix, electiveCompleted, electiveValidated } = params;
  const hasExplicitElectiveCatalog = matrix.disciplines.some((discipline) => discipline.category === "ELECTIVE");
  if (hasExplicitElectiveCatalog || matrix.totals.electiveCHT <= 0) {
    return { pending: [], nodes: [], alerts: [] };
  }

  const validatedNotMapped = Math.max(electiveValidated - electiveCompleted, 0);
  const missingNotMapped = Math.max(matrix.totals.electiveCHT - electiveValidated, 0);
  const validatedUnits = splitSyntheticElectiveUnits(validatedNotMapped);
  const missingUnits = splitSyntheticElectiveUnits(missingNotMapped);

  const nodes: PrereqGraphNode[] = [];
  const pending: PendingDiscipline[] = [];

  for (let index = 0; index < validatedUnits.length; index += 1) {
    const cht = validatedUnits[index];
    const code = formatSyntheticElectiveCode(SYNTHETIC_ELECTIVE_DONE_PREFIX, index + 1, cht);
    nodes.push({
      code,
      name: `Eletiva Livre Validada ${index + 1}`,
      status: "DONE",
      category: "ELECTIVE",
      subcategory: "Eletiva Livre",
      recommendedPeriod: SYNTHETIC_ELECTIVE_DEFAULT_PERIOD,
      cht,
      prerequisites: [],
      dependents: []
    });
  }

  for (let index = 0; index < missingUnits.length; index += 1) {
    const cht = missingUnits[index];
    const code = formatSyntheticElectiveCode(SYNTHETIC_ELECTIVE_PENDING_PREFIX, index + 1, cht);
    nodes.push({
      code,
      name: `Eletiva Livre Pendente ${index + 1}`,
      status: "AVAILABLE",
      category: "ELECTIVE",
      subcategory: "Eletiva Livre",
      recommendedPeriod: SYNTHETIC_ELECTIVE_DEFAULT_PERIOD,
      cht,
      prerequisites: [],
      dependents: []
    });
    pending.push({
      code,
      name: `Eletiva Livre Pendente ${index + 1}`,
      category: "ELECTIVE",
      subcategory: "Eletiva Livre",
      recommendedPeriod: SYNTHETIC_ELECTIVE_DEFAULT_PERIOD,
      prerequisites: [],
      blockedBy: [],
      status: "AVAILABLE",
      cht,
      chext: 0
    });
  }

  const alerts: string[] = [];
  if (validatedUnits.length > 0 || missingUnits.length > 0) {
    alerts.push(
      "Matriz sem catálogo fixo de eletivas: a carga eletiva foi representada como blocos de Eletiva Livre (ELVP/ELVD)."
    );
  }

  return { pending, nodes, alerts };
}

function computePending(matrix: CurriculumMatrix, completedCodes: Set<string>): PendingDiscipline[] {
  return matrix.disciplines
    .filter((discipline) => !discipline.catalogOnly)
    .filter((discipline) => !completedCodes.has(discipline.code))
    .map((discipline) => {
      const blockedBy = discipline.prerequisites.filter((prereq) => !completedCodes.has(prereq));
      const status: PendingDiscipline["status"] = blockedBy.length === 0 ? "AVAILABLE" : "BLOCKED";
      return {
        code: discipline.code,
        name: discipline.name,
        category: discipline.category,
        subcategory: discipline.subcategory,
        recommendedPeriod: discipline.recommendedPeriod,
        prerequisites: discipline.prerequisites,
        blockedBy,
        status,
        cht: discipline.cht,
        chext: discipline.chext ?? 0
      };
    })
    .sort((a, b) => {
      const periodA = a.recommendedPeriod ?? 99;
      const periodB = b.recommendedPeriod ?? 99;
      if (periodA !== periodB) {
        return periodA - periodB;
      }
      if (a.status !== b.status) {
        return a.status === "AVAILABLE" ? -1 : 1;
      }
      return a.code.localeCompare(b.code);
    });
}

function computeUnused(
  parsed: ParsedTranscript,
  completedSourceCodes: Set<string>,
  completedAttempts: TranscriptAttempt[],
  params?: {
    equivalenceSourceCodes?: Set<string>;
    isEngCompMigration?: boolean;
  }
): UnusedDiscipline[] {
  const equivalenceSourceCodes = params?.equivalenceSourceCodes ?? new Set<string>();
  const isEngCompMigration = params?.isEngCompMigration ?? false;
  const output: UnusedDiscipline[] = [];
  const seen = new Set<string>();

  for (const attempt of completedAttempts) {
    const sourceCode = normalizeDisciplineCode(attempt.code);
    const key = `${sourceCode}-${attempt.year ?? 0}-${attempt.semester ?? 0}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (completedSourceCodes.has(sourceCode)) {
      continue;
    }

    const reason =
      attempt.sourceSection === "elective"
        ? "Disciplina cursada em eletivas, mas não validada para a matriz selecionada."
        : "Disciplina não utilizada no cálculo da matriz ativa.";
    const reasonCode =
      attempt.sourceSection === "elective"
        ? "ELECTIVE_NO_TARGET"
        : isEngCompMigration && !equivalenceSourceCodes.has(sourceCode)
          ? "NO_EQUIVALENCE_RULE"
          : "OTHER";

    output.push({
      code: sourceCode,
      name: attempt.name || sourceCode,
      cht: attempt.cht,
      reason,
      reasonCode,
      relatedSubjects: [`${sourceCode} - ${attempt.name || sourceCode}`]
    });
  }

  if (output.length === 0 && parsed.summary.find((row) => row.key.toLowerCase().includes("eletivas") && (row.taken ?? 0) > 0 && (row.approvedOrValidated ?? 0) === 0)) {
    const electiveLikeAttempts = parsed.attempts.filter((attempt) => {
      if (attempt.sourceSection === "elective") {
        return true;
      }

      const code = normalizeDisciplineCode(attempt.code);
      const name = (attempt.name ?? "").toLowerCase();
      return code.startsWith("ELE") || code.startsWith("ELV") || name.includes("eletiv");
    });

    const relatedSubjects = [...new Set(electiveLikeAttempts.map((attempt) => {
      const code = normalizeDisciplineCode(attempt.code);
      const name = attempt.name?.trim() || code;
      return `${code} - ${name}`;
    }).filter(Boolean))];

    const relatedSubjectsWithFallback =
      relatedSubjects.length > 0
        ? relatedSubjects
        : ["Não foi possível identificar as eletivas individualmente no parse do histórico."];

    output.push({
      code: "ELETIVAS",
      name: "Carga eletiva cursada sem validação",
      cht: parsed.summary.find((row) => row.key.toLowerCase().includes("eletivas"))?.taken ?? 0,
      reason: "Há carga eletiva cursada no histórico sem validação final para integralização.",
      reasonCode: "ELECTIVE_NO_TARGET",
      relatedSubjects: relatedSubjectsWithFallback
    });
  }

  return output;
}

function buildElectiveOptionsFromCatalog(params: {
  matrix: CurriculumMatrix;
  catalogByCode: Map<string, MatrixCatalogDiscipline>;
  completedCodes: Set<string>;
}): ElectiveOption[] {
  const { matrix, catalogByCode, completedCodes } = params;
  const explicitElectiveCodes = new Set(
    matrix.disciplines.filter((discipline) => discipline.category === "ELECTIVE").map((discipline) => discipline.code)
  );

  const options: ElectiveOption[] = [];

  for (const discipline of catalogByCode.values()) {
    const code = normalizeDisciplineCode(discipline.code);
    if (!code || explicitElectiveCodes.has(code)) {
      continue;
    }

    const belongsToElectiveGroup = discipline.optGroup ? CATALOG_ELECTIVE_GROUPS.has(discipline.optGroup) : false;
    const isElectiveByCode = code.startsWith("ELE");
    if (!belongsToElectiveGroup && !isElectiveByCode) {
      continue;
    }

    options.push({
      code,
      name: discipline.name,
      cht: Math.max(discipline.cht ?? 0, 0),
      recommendedPeriod: discipline.period,
      status: completedCodes.has(code) ? "DONE" : "AVAILABLE"
    });
  }

  return options.sort((a, b) => (a.recommendedPeriod ?? 99) - (b.recommendedPeriod ?? 99) || a.code.localeCompare(b.code));
}

export async function calculateRoadmap(
  parsed: ParsedTranscript,
  explicitMatrixCode?: MatrixCode,
  manualMappings?: ManualCorrelationInput[]
): Promise<RoadmapResult> {
  const matrixCode = explicitMatrixCode ?? parsed.detectedMatrixCode;
  if (!matrixCode) {
    throw new Error("Matriz não detectada no histórico. Informe matrixCode manualmente.");
  }

  const [matrix, rules, catalogByCode] = await Promise.all([
    loadCurriculumMatrix(matrixCode),
    loadEquivalenceRules(matrixCode),
    loadMatrixCatalogByCode(matrixCode)
  ]);
  const isEngCompMigration = isEngComp844To962Migration(parsed, matrixCode);
  const equivalenceSourceCodes = new Set(rules.map((rule) => normalizeDisciplineCode(rule.fromCode)).filter(Boolean));
  const matrixCapability = inferMatrixCapability(matrix);

  const canonicalAttempts = parsed.attempts.map((attempt) => {
    const normalizedCode = normalizeDisciplineCode(attempt.code);
    const canonicalDiscipline = catalogByCode.get(normalizedCode);
    if (!canonicalDiscipline) {
      return {
        ...attempt,
        normalizedCode
      };
    }

    return {
      ...attempt,
      code: canonicalDiscipline.code,
      normalizedCode: canonicalDiscipline.code,
      name: canonicalDiscipline.name
    };
  });
  const derivedAttempts = deriveAttempts(canonicalAttempts, rules);

  const bestByTargetCode = new Map<string, DerivedAttempt>();
  for (const attempt of derivedAttempts) {
    const current = bestByTargetCode.get(attempt.targetCode);
    bestByTargetCode.set(attempt.targetCode, chooseBestAttempt(current, attempt));
  }

  const completedCodes = new Set<string>();
  const completedSourceCodes = new Set<string>();
  const completedAttempts = canonicalAttempts.filter((attempt) => attempt.status === "APPROVED");

  const matrixCodeSet = new Set(matrix.disciplines.map((discipline) => discipline.code));
  const catalogCodeSet = new Set(catalogByCode.keys());
  for (const [targetCode, attempt] of bestByTargetCode.entries()) {
    if (attempt.status !== "APPROVED") {
      continue;
    }

    if (matrixCodeSet.has(targetCode)) {
      completedCodes.add(targetCode);
    }

    if (catalogCodeSet.has(targetCode)) {
      completedSourceCodes.add(attempt.sourceCode);
    }
  }

  const rawConvalidationMatches = extractApprovedConvalidationCodes(parsed.rawText).filter((match) =>
    matrixCodeSet.has(match.code)
  );
  for (const match of rawConvalidationMatches) {
    completedCodes.add(match.code);
  }

  const manualCorrelationOutcome = applyManualCorrelationMatches({
    matrix,
    attempts: canonicalAttempts,
    completedCodes,
    completedSourceCodes,
    manualMappings
  });
  const manualMatches = manualCorrelationOutcome.matches;
  const manualCreditedByCategory = manualCorrelationOutcome.creditedByCategory;

  const nameFallbackMatches = isEngCompMigration
    ? applyConservativeNameInferenceForEngComp({
        matrix,
        attempts: canonicalAttempts,
        completedCodes,
        completedSourceCodes,
        rules
      })
    : applyNameFallbackMatches({
        matrix,
        attempts: canonicalAttempts,
        completedCodes,
        completedSourceCodes
      });

  const mandatoryCompleted = sumCHTByCategory(matrix, completedCodes, ["MANDATORY"]);
  const optionalCompleted = sumCHTByCategory(matrix, completedCodes, ["OPTIONAL"]);
  const trackCompleted = sumCHTByCategory(matrix, completedCodes, ["TRACK"]);
  const electiveCompleted = sumCHTByCategory(matrix, completedCodes, ["ELECTIVE"]);
  const complementaryCompleted = sumCHTByCategory(matrix, completedCodes, ["COMPLEMENTARY"]);
  const internshipCompleted = sumCHTByCategory(matrix, completedCodes, ["INTERNSHIP"]);
  const tccCompleted = sumCHTByCategory(matrix, completedCodes, ["TCC"]);

  const mandatoryValidated = Math.max(
    mandatoryCompleted + (manualCreditedByCategory.MANDATORY ?? 0),
    getSummaryValue(parsed, "Obrigatórias", "approvedOrValidated") ?? 0
  );

  const optionalAndTrackManualCredits = (manualCreditedByCategory.OPTIONAL ?? 0) + (manualCreditedByCategory.TRACK ?? 0);
  const optionalValidated = Math.max(
    optionalCompleted + trackCompleted + optionalAndTrackManualCredits,
    getSummaryValue(parsed, "Optativas", "approvedOrValidated") ?? 0
  );
  const electiveValidated = Math.max(
    electiveCompleted + (manualCreditedByCategory.ELECTIVE ?? 0),
    getSummaryValue(parsed, "Eletivas", "approvedOrValidated") ?? 0
  );
  const complementaryValidated = complementaryCompleted + (manualCreditedByCategory.COMPLEMENTARY ?? 0);
  const internshipValidated = internshipCompleted + (manualCreditedByCategory.INTERNSHIP ?? 0);
  const tccValidated = tccCompleted + (manualCreditedByCategory.TCC ?? 0);
  const extensionCompleted = Math.max(
    getExtensionTaken(parsed),
    completedAttempts.reduce((sum, attempt) => sum + (attempt.chext ?? 0), 0)
  );

  const progress: ProgressBucket[] = [];
  if (matrixCapability.hasMandatory) {
    progress.push(makeBucket("mandatory", "Obrigatórias", matrix.totals.mandatoryCHT, mandatoryCompleted, mandatoryValidated));
  }
  if (matrixCapability.hasOptional || matrixCapability.hasTrack) {
    progress.push(makeBucket("optional", "Optativas", matrix.totals.optionalCHT, optionalCompleted, optionalValidated));
  }
  if (matrixCapability.hasElective) {
    progress.push(makeBucket("elective", "Eletivas", matrix.totals.electiveCHT, electiveCompleted, electiveValidated));
  }
  if (matrixCapability.hasComplementary) {
    progress.push(
      makeBucket(
        "complementary",
        "Atividades Complementares",
        matrix.totals.complementaryCHT,
        complementaryCompleted,
        complementaryValidated
      )
    );
  }
  if (matrixCapability.hasInternship) {
    progress.push(makeBucket("internship", "Estágio", matrix.totals.internshipCHT, internshipCompleted, internshipValidated));
  }
  if (matrixCapability.hasTcc) {
    progress.push(makeBucket("tcc", "TCC", matrix.totals.tccCHT, tccCompleted, tccValidated));
  }
  if (matrixCapability.hasExtension) {
    progress.push(makeBucket("extension", "Atividades Extensionistas", matrix.totals.extensionCHT, extensionCompleted));
  }

  const syntheticElectiveData = buildSyntheticElectiveData({
    matrix,
    electiveCompleted,
    electiveValidated
  });

  const pending = [...computePending(matrix, completedCodes), ...syntheticElectiveData.pending].sort((a, b) => {
    const periodA = a.recommendedPeriod ?? 99;
    const periodB = b.recommendedPeriod ?? 99;
    if (periodA !== periodB) {
      return periodA - periodB;
    }
    if (a.status !== b.status) {
      return a.status === "AVAILABLE" ? -1 : 1;
    }
    return a.code.localeCompare(b.code);
  });

  const explicitMissingCodes = new Set(parsed.explicitMissing.map((item) => normalizeDisciplineCode(item.code)));
  const pendingCodeSet = new Set(pending.map((item) => item.code));
  const unresolvedExplicitMissing = [...explicitMissingCodes].filter((code) => !pendingCodeSet.has(code));

  const unusedDisciplines = computeUnused(parsed, completedSourceCodes, completedAttempts, {
    equivalenceSourceCodes,
    isEngCompMigration
  });
  const unmatchedApprovedAttempts = buildUnmatchedApprovedAttempts({
    matrix,
    rules,
    completedCodes,
    completedSourceCodes,
    completedAttempts
  });
  const electiveOptions = buildElectiveOptionsFromCatalog({
    matrix,
    catalogByCode,
    completedCodes
  });

  const outsideScopeCodes = completedAttempts
    .map((attempt) => normalizeDisciplineCode(attempt.code))
    .filter((code) => !matrixCodeSet.has(code) && !catalogCodeSet.has(code));

  const basePrereqGraph = buildPrereqGraph({
    matrix,
    completedCodes,
    outsideScopeCodes
  });
  const prereqGraphNodeCodes = new Set(basePrereqGraph.nodes.map((node) => node.code));
  const syntheticGraphNodes = syntheticElectiveData.nodes.filter((node) => !prereqGraphNodeCodes.has(node.code));
  const prereqGraph = {
    nodes: [...basePrereqGraph.nodes, ...syntheticGraphNodes],
    edges: basePrereqGraph.edges
  };

  const alerts: string[] = [];
  if (parsed.detectedMatrixCode && parsed.detectedMatrixCode !== matrixCode) {
    alerts.push(`Matriz detectada no PDF (${parsed.detectedMatrixCode}) difere da matriz utilizada (${matrixCode}).`);
  }
  if (parsed.unparsedBlocks.length > 0) {
    alerts.push(`Há ${parsed.unparsedBlocks.length} bloco(s) que exigem revisão manual.`);
  }
  if (unresolvedExplicitMissing.length > 0) {
    alerts.push(`Itens de faltantes explícitos não localizados na matriz interna: ${unresolvedExplicitMissing.join(", ")}.`);
  }
  alerts.push(...syntheticElectiveData.alerts);
  if (manualMatches.length > 0) {
    const sample = manualMatches
      .slice(0, 4)
      .map((item) => `${item.sourceCode}->${item.targetCode ?? "MANUAL"}(${item.creditedCHT}h/${item.targetCategory})`)
      .join(", ");
    alerts.push(
      `Correlação manual aplicada em ${manualMatches.length} disciplina(s) (${sample}${manualMatches.length > 4 ? ", ..." : ""}).`
    );
  }
  if (nameFallbackMatches.length > 0) {
    const sample = nameFallbackMatches
      .slice(0, 3)
      .map((item) => `${item.sourceCode}->${item.targetCode}`)
      .join(", ");
    if (isEngCompMigration) {
      alerts.push(
        `Inferência conservadora aplicada em ${nameFallbackMatches.length} disciplina(s) sem regra oficial (${sample}${nameFallbackMatches.length > 3 ? ", ..." : ""}).`
      );
    } else {
      alerts.push(
        `Fallback por nome aplicado em ${nameFallbackMatches.length} disciplina(s) sem match por código (${sample}${nameFallbackMatches.length > 3 ? ", ..." : ""}).`
      );
    }
  }
  if (rawConvalidationMatches.length > 0) {
    const sample = rawConvalidationMatches
      .slice(0, 4)
      .map((item) => item.code)
      .join(", ");
    alerts.push(
      `Convalidações aprovadas detectadas no histórico bruto e aplicadas no cálculo (${sample}${rawConvalidationMatches.length > 4 ? ", ..." : ""}).`
    );
  }

  return {
    matrixCode,
    student: parsed.student,
    progress,
    pending,
    prereqGraph,
    unusedDisciplines,
    unmatchedApprovedAttempts,
    electiveOptions,
    alerts,
    transcriptWarnings: parsed.warnings,
    computedAt: new Date().toISOString()
  };
}
