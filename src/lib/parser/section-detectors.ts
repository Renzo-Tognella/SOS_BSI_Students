export interface SectionRange {
  start: number;
  end: number;
  title: string;
}

export interface DetectedSections {
  header: SectionRange;
  mandatory?: SectionRange;
  optional?: SectionRange;
  elective?: SectionRange;
  explicitMissing?: SectionRange;
  dependencies?: SectionRange;
  summary?: SectionRange;
  extensionSummary?: SectionRange;
}

function findIndexOrEnd(text: string, needle: string, fallback = text.length): number {
  const index = text.indexOf(needle);
  return index === -1 ? fallback : index;
}

function makeRange(text: string, startNeedle: string, endNeedles: string[]): SectionRange | undefined {
  const start = text.indexOf(startNeedle);
  if (start === -1) {
    return undefined;
  }

  let end = text.length;
  for (const needle of endNeedles) {
    const index = text.indexOf(needle, start + startNeedle.length);
    if (index !== -1 && index < end) {
      end = index;
    }
  }

  return { start, end, title: startNeedle };
}

export function detectSections(text: string): DetectedSections {
  const headerEnd = findIndexOrEnd(text, "Disciplinas Obrigatórias", Math.min(text.length, 3000));
  const header: SectionRange = {
    start: 0,
    end: headerEnd,
    title: "header"
  };

  const mandatory = makeRange(text, "Disciplinas Obrigatórias Cursadas", ["Disciplinas Optativas", "Resumo Geral"]);
  const optional = makeRange(text, "Disciplinas Optativas Cursadas", ["Resumo Optativas", "Eletivas", "Resumo Geral"]);
  const elective = makeRange(text, "Detalhes das Disciplinas Eletivas", ["Resumo Eletiva", "Resumo Geral"]);
  const explicitMissing = makeRange(text, "Disciplinas Obrigatórias Faltantes", ["Dependências", "Disciplinas Matriculadas"]);
  const dependencies = makeRange(text, "Dependências", ["Disciplinas Matriculadas", "Resumo Geral"]);
  const summary = makeRange(text, "Quadro Resumo disciplinas", ["Quadro Resumo Atividades Extensionistas"]);
  const extensionSummary = makeRange(text, "Quadro Resumo Atividades Extensionistas", ["Detalhes das CHExt", "UTFPR - Curitiba"]);

  return {
    header,
    mandatory,
    optional,
    elective,
    explicitMissing,
    dependencies,
    summary,
    extensionSummary
  };
}

export function sliceByRange(text: string, range?: SectionRange): string {
  if (!range) {
    return "";
  }
  return text.slice(range.start, range.end);
}
