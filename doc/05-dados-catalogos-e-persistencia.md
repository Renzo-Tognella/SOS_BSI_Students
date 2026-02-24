# Dados, Catálogos e Persistência

## Matrizes curriculares (fonte interna)

Pasta:

- `data/matrizes`

Arquivos centrais:

- `981.json`
- `806.json`
- `equivalencias_806_981.json`
- `981_catalog.json` (catálogo suplementar)

## Totais oficiais cadastrados no JSON (matriz 981)

- Obrigatórias: 2005h
- Optativas: 840h
- Eletivas: 105h
- Complementares: 90h
- Estágio: 400h
- TCC: 60h
- Extensão: 330h

## Totais oficiais cadastrados no JSON (matriz 806)

- Obrigatórias: 1875h
- Optativas: 630h
- Eletivas: 225h
- Complementares: 180h
- Estágio: 360h
- TCC: 60h
- Extensão: 0h

## Equivalências

Arquivo:

- `data/matrizes/equivalencias_806_981.json`

Uso:

- quando há mudança de código entre matrizes;
- ajuda a aproveitar aprovações antigas na matriz ativa.

## Catálogo suplementar

Arquivo:

- `data/matrizes/981_catalog.json`

Uso:

- lookup/normalização de disciplinas fora do núcleo mínimo do JSON principal;
- suporte a disciplinas de trilha e catálogo ampliado.

---

## Dados externos

### GradeNaHora

- base: `https://gradenahora.com.br/utfpr`
- consumo dinâmico por semestre/campus/curso
- fallback automático para semestres anteriores quando não há arquivo no semestre mais novo.

### Fontes UTFPR usadas pelo assistente

O endpoint do assistente inclui links institucionais de referência para:

- curso BSI Curitiba
- matriz/docentes
- matrícula de veteranos
- calendário 2026 Curitiba
- datas especiais 2026 Curitiba

---

## Persistência local no navegador

Chaves:

- `roadmap_workspace_state_v2`
- `roadmap_workspace_export_state_v1`

Dados salvos:

- histórico parseado
- roadmap calculado
- grade options
- filtros de categoria
- trilhas selecionadas
- plano manual drag-and-drop
- overrides/correlações/convalidações manuais
- histórico de mensagens do assistente

---

## Notas de consistência operacional

1. O sistema pode operar sem LLM (fallback rule-based no assistente).
2. O cálculo principal depende da qualidade do parse do PDF.
3. Quando o resumo oficial do histórico está incompleto, o forecast usa fallback interno (soma de faltantes do roadmap) e registra aviso.
