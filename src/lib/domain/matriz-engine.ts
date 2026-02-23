import { readFile } from "node:fs/promises";
import path from "node:path";

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

interface RawConvalidationMatch {
  code: string;
  reason: string;
}

interface ManualMatchResult {
  sourceCode: string;
  targetCode: string;
  sourceName: string;
  targetName: string;
}

const SYNTHETIC_ELECTIVE_PENDING_PREFIX = "ELVP";
const SYNTHETIC_ELECTIVE_DONE_PREFIX = "ELVD";
const SYNTHETIC_ELECTIVE_DEFAULT_PERIOD = 8;
const SYNTHETIC_ELECTIVE_UNIT_CHT = 15;
const CATALOG_ELECTIVE_GROUPS = new Set(["1171"]);

async function readJsonFromRoot<T>(relativePath: string): Promise<T> {
  const absolute = path.join(process.cwd(), relativePath);
  const payload = await readFile(absolute, "utf8");
  return JSON.parse(payload) as T;
}

export async function loadCurriculumMatrix(matrixCode: MatrixCode): Promise<CurriculumMatrix> {
  return readJsonFromRoot<CurriculumMatrix>(`data/matrizes/${matrixCode}.json`);
}

export async function loadEquivalenceRules(): Promise<EquivalenceRule[]> {
  return readJsonFromRoot<EquivalenceRule[]>("data/matrizes/equivalencias_806_981.json");
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
  matrixCode: MatrixCode,
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

    if (matrixCode === "981") {
      const rule = ruleMap.get(sourceCode);
      if (rule) {
        for (const target of rule.toCodes) {
          targets.add(target);
        }
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
}): ManualMatchResult[] {
  const { matrix, attempts, completedCodes, completedSourceCodes, manualMappings = [] } = params;
  if (!Array.isArray(manualMappings) || manualMappings.length === 0) {
    return [];
  }

  const matrixByCode = new Map(matrix.disciplines.map((discipline) => [normalizeDisciplineCode(discipline.code), discipline]));
  const mappingBySourceCode = new Map<string, string>();
  const mappingBySourceName = new Map<string, string>();

  for (const mapping of manualMappings) {
    const targetCode = normalizeDisciplineCode(mapping.targetCode ?? "");
    if (!targetCode || !matrixByCode.has(targetCode)) {
      continue;
    }

    const sourceCode = normalizeDisciplineCode(mapping.sourceCode ?? "");
    if (sourceCode) {
      mappingBySourceCode.set(sourceCode, targetCode);
    }

    const sourceName = normalizeDisciplineNameForComparison(mapping.sourceName ?? "");
    if (sourceName) {
      mappingBySourceName.set(sourceName, targetCode);
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
    const targetCode = mappingBySourceCode.get(sourceCode) ?? (normalizedName ? mappingBySourceName.get(normalizedName) : undefined);
    if (!targetCode) {
      continue;
    }

    const targetDiscipline = matrixByCode.get(targetCode);
    if (!targetDiscipline) {
      continue;
    }

    completedCodes.add(targetCode);
    completedSourceCodes.add(sourceCode);
    matches.push({
      sourceCode,
      sourceName,
      targetCode,
      targetName: targetDiscipline.name
    });
  }

  return matches;
}

function buildUnmatchedApprovedAttempts(params: {
  matrix: CurriculumMatrix;
  completedCodes: Set<string>;
  completedSourceCodes: Set<string>;
  completedAttempts: TranscriptAttempt[];
}): UnmatchedApprovedAttempt[] {
  const { matrix, completedCodes, completedSourceCodes, completedAttempts } = params;
  const matrixCandidates = matrix.disciplines
    .filter((discipline) => !completedCodes.has(discipline.code))
    .sort((a, b) => (a.recommendedPeriod ?? 99) - (b.recommendedPeriod ?? 99) || a.code.localeCompare(b.code));

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

    for (const discipline of matrixCandidates) {
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

function getSummaryValue(
  parsed: ParsedTranscript,
  rowNeedle: string,
  key: "approvedOrValidated" | "taken" | "missing" | "approvedByStudent"
): number | undefined {
  const row = parsed.summary.find((item) => item.key.toLowerCase().includes(rowNeedle.toLowerCase()));
  return row?.[key] as number | undefined;
}

function getExtensionTaken(parsed: ParsedTranscript): number {
  const row = parsed.extensionSummary.find((item) => item.key.toLowerCase().includes("geral"));
  return row?.taken ?? 0;
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
  completedAttempts: TranscriptAttempt[]
): UnusedDiscipline[] {
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

    output.push({
      code: sourceCode,
      name: attempt.name || sourceCode,
      cht: attempt.cht,
      reason,
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
    loadEquivalenceRules(),
    loadMatrixCatalogByCode(matrixCode)
  ]);
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
  const derivedAttempts = deriveAttempts(canonicalAttempts, matrixCode, rules);

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

  const manualMatches = applyManualCorrelationMatches({
    matrix,
    attempts: canonicalAttempts,
    completedCodes,
    completedSourceCodes,
    manualMappings
  });

  const nameFallbackMatches = applyNameFallbackMatches({
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

  const optionalValidated = Math.max(
    optionalCompleted + trackCompleted,
    getSummaryValue(parsed, "Optativas", "approvedOrValidated") ?? 0
  );
  const electiveValidated = Math.max(electiveCompleted, getSummaryValue(parsed, "Eletivas", "approvedOrValidated") ?? 0);
  const mandatoryValidated = Math.max(mandatoryCompleted, getSummaryValue(parsed, "Obrigatórias", "approvedOrValidated") ?? 0);

  const extensionCompleted = Math.max(getExtensionTaken(parsed), completedAttempts.reduce((sum, attempt) => sum + (attempt.chext ?? 0), 0));

  const progress: ProgressBucket[] = [
    makeBucket("mandatory", "Obrigatórias", matrix.totals.mandatoryCHT, mandatoryCompleted, mandatoryValidated),
    makeBucket("optional", "Optativas", matrix.totals.optionalCHT, optionalCompleted, optionalValidated),
    makeBucket("elective", "Eletivas", matrix.totals.electiveCHT, electiveCompleted, electiveValidated),
    makeBucket("complementary", "Atividades Complementares", matrix.totals.complementaryCHT, complementaryCompleted),
    makeBucket("internship", "Estágio", matrix.totals.internshipCHT, internshipCompleted),
    makeBucket("tcc", "TCC", matrix.totals.tccCHT, tccCompleted),
    makeBucket("extension", "Atividades Extensionistas", matrix.totals.extensionCHT, extensionCompleted)
  ];

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

  const unusedDisciplines = computeUnused(parsed, completedSourceCodes, completedAttempts);
  const unmatchedApprovedAttempts = buildUnmatchedApprovedAttempts({
    matrix,
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
      .map((item) => `${item.sourceCode}->${item.targetCode}`)
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
    alerts.push(
      `Fallback por nome aplicado em ${nameFallbackMatches.length} disciplina(s) sem match por código (${sample}${nameFallbackMatches.length > 3 ? ", ..." : ""}).`
    );
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
