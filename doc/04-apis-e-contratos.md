# APIs e Contratos

## Resumo dos endpoints

- `POST /api/roadmap/parse`
- `POST /api/roadmap/calculate`
- `GET /api/roadmap/lookup-disciplines`
- `GET /api/grade/options`
- `POST /api/assistant/chat`
- `POST /api/report/pdf`

---

## `POST /api/roadmap/parse`

Arquivo: `src/app/api/roadmap/parse/route.ts`

Entrada:

- `multipart/form-data`
- campo `pdf` (ou `file`)

Validações:

- arquivo obrigatório;
- tipo PDF quando `file.type` estiver presente.

Saída:

- `ParsedTranscript`

Comportamento adicional:

- se matriz for detectada, aplica catálogo canônico para ajustar `code` e `name` das tentativas.

---

## `POST /api/roadmap/calculate`

Arquivo: `src/app/api/roadmap/calculate/route.ts`

Body:

- `parsedTranscript` (obrigatório)
- `matrixCode` (opcional: `806` ou `981`)
- `manualMappings` (opcional)

Saída:

- `RoadmapResult`

Observação:

- se houver `rawText`, o endpoint reparseia com `parseHistoricoText(rawText)` antes de calcular.

---

## `GET /api/roadmap/lookup-disciplines`

Arquivo: `src/app/api/roadmap/lookup-disciplines/route.ts`

Objetivo:

- montar lookup global de disciplinas para convalidação manual.

Fonte:

- matrizes `806` e `981`.

Saída:

- `DisciplineLookupResponse` com:
  - código
  - nome
  - categoria
  - subcategoria/trilha
  - matriz
  - curso abreviado
  - indicador `catalogOnly`

---

## `GET /api/grade/options`

Arquivo: `src/app/api/grade/options/route.ts`

Query params:

- `matrix` (`806` ou `981`) obrigatório
- `course` obrigatório
- `campus` obrigatório
- `pending` opcional (csv de códigos)
- `maxChs` opcional (1..40)

Saída:

- `GradeOptionsResponse`:
  - semestre usado
  - oferta por disciplina/turmas
  - combinações possíveis sem conflito
  - plano automático por períodos
  - warnings

---

## `POST /api/assistant/chat`

Arquivo: `src/app/api/assistant/chat/route.ts`

Body:

- `message` (obrigatório)
- `matrixCode` (opcional)
- `roadmap` (opcional no schema, mas necessário para respostas úteis)
- `parsedTranscript` (opcional)
- `gradeOptions` (opcional)
- `selectedTrackLabels` (opcional)
- `selectedPeriodIndex` (opcional, legado)
- `maxChsPerPeriod` (opcional)

Saída:

- `AssistantChatResponse`:
  - `answer`
  - `action` (`ASK_PERIOD` | `SHOW_PROPOSALS` | `INFO`)
  - `detectedIntent`
  - `detectedConstraints`
  - `proposals` (quando `SHOW_PROPOSALS`)
  - `question` (quando `ASK_PERIOD`)
  - `autoApplied` (`false` no fluxo atual)
  - `planPatch` (legado, compatibilidade temporária)
  - `providerUsed` e `diagnostics`

Intents suportados:

- `PLAN_SCHEDULE`
- `GRADUATION_ESTIMATE`
- `TRACK_IA`
- `AVAILABLE_DISCIPLINES`
- `GENERAL_HELP`

Pipeline de classificação:

- OpenRouter -> Gemini -> fallback rule-based.

---

## `POST /api/report/pdf`

Arquivo: `src/app/api/report/pdf/route.ts`

Body:

- `roadmap` (obrigatório)
- `parsedTranscript` (opcional)
- `plannerSnapshot` (opcional)

Saída:

- PDF (`application/pdf`)

Geração:

1. tenta Puppeteer (HTML renderizado)
2. fallback em `pdf-lib` se Puppeteer falhar

Inclui no relatório:

- progresso por categoria
- pendências
- plano de grade atual
- não utilizadas
- alertas
- nota metodológica do forecast

---

## Erros e status

Padrão de erro:

- validação -> `400` com `error` e `issues` (quando zod)
- erro de execução -> `500` com `error` e `details`
