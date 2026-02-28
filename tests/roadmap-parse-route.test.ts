import { describe, expect, it } from "vitest";

import { looksLikeCurriculumMatrixDocument } from "@/lib/parser/document-type";

describe("roadmap parse route", () => {
  it("detects matrix curricular document content", () => {
    const matrixText = [
      "Consulta Curso e Matriz Curricular",
      "Matriz Curricular - Versão 2",
      "Campus Curitiba"
    ].join("\n");

    expect(looksLikeCurriculumMatrixDocument(matrixText)).toBe(true);
  });

  it("does not flag regular student transcript content as matrix curricular", () => {
    const transcriptText = [
      "Histórico Escolar",
      "Aluno: 123456 - Teste de Aluno",
      "Matriz: 844 - Matriz 3 de Eng de Computação",
      "Disciplinas Obrigatórias"
    ].join("\n");

    expect(looksLikeCurriculumMatrixDocument(transcriptText)).toBe(false);
  });
});
