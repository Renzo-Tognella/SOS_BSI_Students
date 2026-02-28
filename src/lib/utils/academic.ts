import type { DisciplineStatus } from "@/types/academic";

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
}

export function parsePtNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized === "*" || normalized.toLowerCase() === "faltantes") {
    return null;
  }

  let candidate = normalized;
  if (candidate.includes(",") && candidate.includes(".")) {
    candidate = candidate.replace(/\./g, "").replace(",", ".");
  } else if (candidate.includes(",")) {
    candidate = candidate.replace(",", ".");
  }
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseIntSafe(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const numeric = Number(value.trim());
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function normalizeDisciplineCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeDisciplineName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DISCIPLINE_NAME_STOPWORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "para",
  "ao",
  "a",
  "o",
  "as",
  "os",
  "na",
  "no",
  "nas",
  "nos"
]);

const ROMAN_NUMERAL_TO_ARABIC: Record<string, string> = {
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10"
};

function isLikelyDisciplineCodeToken(token: string): boolean {
  return /^[a-z]{2,}\d{2,}[a-z0-9]*$/.test(token);
}

function normalizeLevelToken(token: string): string | null {
  if (/^\d+$/.test(token)) {
    return token;
  }
  return ROMAN_NUMERAL_TO_ARABIC[token] ?? null;
}

export function tokenizeDisciplineName(value: string): string[] {
  return normalizeDisciplineName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => {
      if (!token || DISCIPLINE_NAME_STOPWORDS.has(token) || isLikelyDisciplineCodeToken(token)) {
        return false;
      }
      if (normalizeLevelToken(token)) {
        return true;
      }
      return token.length > 1;
    });
}

export function normalizeDisciplineNameForComparison(value: string): string {
  return tokenizeDisciplineName(value).join(" ");
}

export function disciplineNamesLikelyMatch(nameA: string, nameB: string): boolean {
  const normalizedA = normalizeDisciplineNameForComparison(nameA);
  const normalizedB = normalizeDisciplineNameForComparison(nameB);
  if (!normalizedA || !normalizedB) {
    return false;
  }

  if (normalizedA === normalizedB) {
    return true;
  }

  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) {
    const minLength = Math.min(normalizedA.length, normalizedB.length);
    if (minLength >= 12) {
      return true;
    }
  }

  const tokensA = new Set(normalizedA.split(" ").filter(Boolean));
  const tokensB = new Set(normalizedB.split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) {
    return false;
  }

  const levelsA = new Set([...tokensA].map((token) => normalizeLevelToken(token)).filter((token): token is string => Boolean(token)));
  const levelsB = new Set([...tokensB].map((token) => normalizeLevelToken(token)).filter((token): token is string => Boolean(token)));
  if (levelsA.size > 0 && levelsB.size > 0) {
    const hasCommonLevel = [...levelsA].some((level) => levelsB.has(level));
    if (!hasCommonLevel) {
      return false;
    }
  }

  let common = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      common += 1;
    }
  }

  const base = Math.min(tokensA.size, tokensB.size);
  if (base === 1) {
    return common === 1;
  }
  return common >= 2 && common / base >= 0.6;
}

export function normalizeStatus(
  statusText: string,
  metrics?: {
    average?: number | null;
    frequency?: number | null;
  }
): DisciplineStatus {
  const plain = statusText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const hasApprovedKeyword = plain.includes("aprovado");
  const hasCreditKeyword = plain.includes("credito consignado") || plain.includes("crédito consignado");
  const hasApprovalSignal = hasApprovedKeyword || hasCreditKeyword;
  const hasFailedKeyword = plain.includes("reprovado");
  const hasCanceledKeyword = plain.includes("cancelado");
  const hasConvalidationKeyword =
    plain.includes("convalid") ||
    plain.includes("mudanca de matriz") ||
    plain.includes("mudança de matriz") ||
    plain.includes("equivalente");
  if (plain.includes("matriculad") || plain.includes("cursando")) {
    return "IN_PROGRESS";
  }

  const average = metrics?.average ?? null;
  const frequency = metrics?.frequency ?? null;
  const hasValidGradeAndFrequency =
    average !== null && Number.isFinite(average) && average >= 5 && (frequency === null || frequency >= 75 || frequency === 0);
  const hasLeakContext =
    plain.includes("doutorado") ||
    plain.includes("mestrado") ||
    plain.includes("fechamento de turmas") ||
    plain.includes("disciplina(s) equivalente(s)");

  // PDFs antigos podem vazar "reprovado/cancelado" de linha vizinha no bloco atual.
  // Quando média/frequência são claramente de aprovação, preserva APPROVED.
  if ((hasFailedKeyword || hasCanceledKeyword) && !hasConvalidationKeyword && hasValidGradeAndFrequency && hasLeakContext) {
    return "APPROVED";
  }

  // Em lançamentos reais de convalidação, aprovação pode vir sem texto perfeito de situação.
  if (hasConvalidationKeyword && (hasApprovalSignal || hasValidGradeAndFrequency)) {
    return "APPROVED";
  }

  // Em PDFs com vazamento de linha, pode haver "aprovado" e "reprovado" no mesmo bloco.
  // Nesses casos, prioriza métricas para evitar falso positivo de aprovação.
  if (hasApprovalSignal && (hasFailedKeyword || hasCanceledKeyword) && !hasConvalidationKeyword) {
    if (average !== null && Number.isFinite(average)) {
      if (average < 5) {
        return hasCanceledKeyword ? "CANCELED" : "FAILED";
      }
      if (hasValidGradeAndFrequency) {
        return "APPROVED";
      }
    }

    if (hasCanceledKeyword) {
      return "CANCELED";
    }
    if (hasFailedKeyword) {
      return "FAILED";
    }
  }

  if (hasApprovalSignal) {
    return "APPROVED";
  }

  if (hasCanceledKeyword && !hasConvalidationKeyword) {
    return "CANCELED";
  }
  if (hasFailedKeyword && !hasConvalidationKeyword) {
    return "FAILED";
  }

  if (average !== null && Number.isFinite(average)) {
    if (average < 5) {
      return hasCanceledKeyword ? "CANCELED" : "FAILED";
    }
    if (hasValidGradeAndFrequency) {
      return "APPROVED";
    }
  }

  if (plain.includes("transfer") || plain.includes("dispensa de disciplina") || hasConvalidationKeyword) {
    return "TRANSFERRED";
  }

  if (hasCanceledKeyword) {
    return "CANCELED";
  }
  if (hasFailedKeyword) {
    return "FAILED";
  }

  return "UNKNOWN";
}

export function isAdministrativeAcademicCredit(statusText: string): boolean {
  const plain = statusText
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    plain.includes("credito consignado") ||
    plain.includes("convalid") ||
    plain.includes("mudanca de matriz") ||
    plain.includes("consignacao manual") ||
    plain.includes("disciplina(s) equivalente(s)") ||
    plain.includes("dispensa de disciplina")
  );
}

export function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}
