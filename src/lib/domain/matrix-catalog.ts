import { readFile } from "node:fs/promises";
import path from "node:path";

import { readEmbeddedJson } from "@/lib/domain/embedded-data";
import { normalizeDisciplineCode } from "@/lib/utils/academic";
import type { CurriculumMatrix, MatrixCatalogDiscipline, MatrixCode } from "@/types/academic";

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

async function readOptionalJsonFromRoot<T>(relativePath: string): Promise<T | null> {
  try {
    return await readJsonFromRoot<T>(relativePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function loadMatrixCatalog(matrixCode: MatrixCode): Promise<MatrixCatalogDiscipline[]> {
  const matrix = await readJsonFromRoot<CurriculumMatrix>(`data/matrizes/${matrixCode}.json`);
  const supplementalCatalog =
    (await readOptionalJsonFromRoot<MatrixCatalogDiscipline[]>(`data/matrizes/${matrixCode}_catalog.json`)) ?? [];

  const catalogByCode = new Map<string, MatrixCatalogDiscipline>();

  for (const discipline of matrix.disciplines) {
    const code = normalizeDisciplineCode(discipline.code);
    if (!code) {
      continue;
    }
    catalogByCode.set(code, {
      code,
      name: discipline.name,
      period: discipline.recommendedPeriod,
      cht: discipline.cht
    });
  }

  for (const discipline of supplementalCatalog) {
    const code = normalizeDisciplineCode(discipline.code ?? "");
    if (!code || catalogByCode.has(code)) {
      continue;
    }
    catalogByCode.set(code, {
      code,
      name: discipline.name,
      period: discipline.period,
      cht: discipline.cht,
      optGroup: discipline.optGroup ?? null
    });
  }

  return [...catalogByCode.values()];
}

export async function loadMatrixCatalogByCode(matrixCode: MatrixCode): Promise<Map<string, MatrixCatalogDiscipline>> {
  const catalog = await loadMatrixCatalog(matrixCode);
  return new Map(catalog.map((discipline) => [normalizeDisciplineCode(discipline.code), discipline]));
}
