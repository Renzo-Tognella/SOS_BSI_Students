export function looksLikeCurriculumMatrixDocument(rawText: string): boolean {
  const normalized = (rawText ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const hasStudentTranscriptHeader = normalized.includes("historico escolar") || normalized.includes("histórico escolar");

  return (
    !hasStudentTranscriptHeader &&
    (normalized.includes("consulta curso e matriz curricular") ||
      normalized.includes("matriz curricular - versao") ||
      normalized.includes("matriz curricular - versão"))
  );
}
