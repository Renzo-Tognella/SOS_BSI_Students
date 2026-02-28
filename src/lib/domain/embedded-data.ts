import type { CurriculumMatrix, EquivalenceRule, MatrixCatalogDiscipline } from "@/types/academic";

import matrix806 from "../../../data/matrizes/806.json";
import matrix981 from "../../../data/matrizes/981.json";
import matrix844 from "../../../data/matrizes/844.json";
import matrix962 from "../../../data/matrizes/962.json";
import matrix981Catalog from "../../../data/matrizes/981_catalog.json";
import matrix962Catalog from "../../../data/matrizes/962_catalog.json";
import equivalences806981 from "../../../data/matrizes/equivalencias_806_981.json";
import equivalences844962 from "../../../data/matrizes/equivalencias_844_962.json";

const EMBEDDED_JSON_BY_PATH: Record<string, unknown> = {
  "data/matrizes/806.json": matrix806 as CurriculumMatrix,
  "data/matrizes/981.json": matrix981 as CurriculumMatrix,
  "data/matrizes/844.json": matrix844 as CurriculumMatrix,
  "data/matrizes/962.json": matrix962 as CurriculumMatrix,
  "data/matrizes/981_catalog.json": matrix981Catalog as MatrixCatalogDiscipline[],
  "data/matrizes/962_catalog.json": matrix962Catalog as MatrixCatalogDiscipline[],
  "data/matrizes/equivalencias_806_981.json": equivalences806981 as EquivalenceRule[],
  "data/matrizes/equivalencias_844_962.json": equivalences844962 as EquivalenceRule[]
};

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function readEmbeddedJson<T>(relativePath: string): T | null {
  const normalized = normalizeRelativePath(relativePath);
  const value = EMBEDDED_JSON_BY_PATH[normalized];
  return (value as T | undefined) ?? null;
}
