# Cálculos e Regras de Negócio

Este documento descreve como os cálculos são feitos no código atual.

## 1) Parsing do histórico

Arquivo principal: `src/lib/parser/historico-parser.ts`

### 1.1 Extração de texto do PDF

Ordem de tentativa:

1. `pdftotext` (layout preservado)
2. fallback JS (`pdf-parse`)
3. OCR (`pdftoppm` + `tesseract`) quando o texto extraído for curto

### 1.2 Detecção de seções

Arquivo: `src/lib/parser/section-detectors.ts`

Seções detectadas:

- obrigatórias cursadas
- optativas cursadas
- eletivas
- faltantes explícitos
- dependências
- quadro resumo de disciplinas
- quadro resumo extensionista

### 1.3 Parse de disciplina (tentativa)

Cada tentativa parseada (`TranscriptAttempt`) contém, entre outros:

- `code`, `name`, `chs`, `cht`, `chext`
- `semester`, `year`
- `average`, `frequency`
- `status` normalizado

### 1.4 Regra de status

Arquivo: `src/lib/utils/academic.ts` (`normalizeStatus`)

A normalização prioriza:

- evitar falso `APPROVED` por vazamento textual;
- preservar convalidações legítimas;
- usar média/frequência como desempate quando o texto mistura aprovado/reprovado.

---

## 2) Cálculo do roadmap acadêmico

Arquivo: `src/lib/domain/matriz-engine.ts`

## 2.1 Normalização inicial

Antes do cálculo:

- código/nome das tentativas são canônicos pela matriz/catálogo;
- para matriz 981, equivalências de código são aplicadas via `equivalencias_806_981.json`;
- também são extraídos alvos de convalidação do texto de status (`Gerou Convalidação - Disc.: CODE`).

## 2.2 Escolha da melhor tentativa por disciplina alvo

Regra (`chooseBestAttempt`):

1. prioriza status `APPROVED`;
2. se empate de status, usa tentativa mais recente (ano/semestre).

## 2.3 Convalidação aprovada detectada no texto bruto

Regra:

- busca padrões de “crédito consignado / convalidação” no `rawText`;
- só aplica quando há sinais contextuais de aprovação/equivalência;
- códigos detectados entram como concluídos no cálculo.

## 2.4 Correlação manual

Entrada: `manualMappings`.

Pode ser:

- por código de destino real da matriz;
- manual-only (sem código da matriz), apenas creditando horas em categoria escolhida.

Regras principais:

- `creditedCHT` default = `attempt.cht`;
- se `manualOnly=true`, não exige destino;
- se não for manual-only e `creditedCHT >= cht da disciplina destino` e a categoria bater, a disciplina destino é marcada como concluída;
- sempre remove a disciplina de origem da lista de não utilizadas quando a convalidação é aplicada.

## 2.5 Fallback por nome

Quando não há match por código:

- compara nomes normalizados (sem acento, stopwords e ruído);
- tenta match exato normalizado;
- depois match “provável” por tokens/nível;
- se encontrar destino elegível, marca concluído.

---

## 3) Buckets de progresso (CHT)

Cada bucket tem:

- `requiredCHT`
- `completedCHT`
- `validatedCHT`
- `missingCHT = max(requiredCHT - validatedCHT, 0)`

Categorias:

- obrigatórias
- optativas
- eletivas
- complementares
- estágio
- TCC
- extensão

### 3.1 Fórmulas de validação

- `mandatoryValidated = max(mandatoryCompleted + créditos manuais MANDATORY, resumo oficial Obrigatórias aprovadas/validadas)`
- `optionalValidated = max(optionalCompleted + trackCompleted + créditos manuais OPTIONAL+TRACK, resumo oficial Optativas aprovadas/validadas)`
- `electiveValidated = max(electiveCompleted + créditos manuais ELECTIVE, resumo oficial Eletivas aprovadas/validadas)`
- `complementaryValidated = complementaryCompleted + créditos manuais COMPLEMENTARY`
- `internshipValidated = internshipCompleted + créditos manuais INTERNSHIP`
- `tccValidated = tccCompleted + créditos manuais TCC`
- `extensionCompleted = max(CHEXT tomada no resumo, soma de chext das tentativas aprovadas)`

---

## 4) Eletivas sintéticas (quando a matriz não tem catálogo explícito)

Se a matriz não traz disciplina ELETIVE explícita:

- o sistema cria blocos sintéticos:
  - `ELVD...` para carga eletiva validada;
  - `ELVP...` para carga eletiva pendente.
- unidade padrão: 15h por bloco.

Objetivo:

- representar déficit eletivo no roadmap mesmo sem lista fixa de disciplinas.

---

## 5) Pendências, bloqueios e não utilizadas

### 5.1 Pendências

- disciplina entra em pendente quando:
  - não está concluída;
  - não é `catalogOnly`;
- status:
  - `AVAILABLE`: sem pré-requisito pendente;
  - `BLOCKED`: possui pré-requisitos não concluídos.

### 5.2 Não utilizadas

Entram em não utilizadas:

- aprovações que não foram mapeadas para a matriz/catálogo ativo.

Regra especial de eletivas:

- se resumo indica eletiva cursada sem validação, cria linha agregada `ELETIVAS` com CHT tomada e evidências.

---

## 6) Filtro de categorias (dashboard e planejamento)

Arquivo central de uso: `src/components/roadmap/roadmap-workspace.tsx`

Categorias filtráveis:

- MANDATORY, OPTIONAL, TRACK, ELECTIVE, COMPLEMENTARY, INTERNSHIP, TCC, EXTENSION, UNKNOWN

Efeitos do filtro:

- recalcula buckets de progresso visíveis;
- recalcula CHT faltante total;
- filtra nós/arestas do grafo usado nas visualizações;
- altera cards, gráficos, roadmap por período e tabela final;
- altera escopo das pendências no planejamento;
- altera base da projeção CHS (via `missingChtOverride`).

---

## 7) Optativas e trilhas (regra de carga oficial)

Constantes no front-end:

- segundo estrato + humanidades = **495h**
- trilhas = **345h**

No roadmap por período:

- o sistema **não soma todo o catálogo de trilhas** como carga exigida;
- usa pool oficial (495h e 345h), ancorado por período recomendado mínimo;
- isso evita inflar faltante com “todas as opções possíveis”.

---

## 8) Projeção de formatura (CHS por semestre)

Arquivo: `src/lib/domain/graduation-forecast.ts`

## 8.1 Histórico CHS

- considera apenas tentativas `APPROVED` com ano/semestre válido;
- CHS por disciplina:
  - usa `attempt.chs` se existir;
  - senão `max(1, round(cht/15))`.

## 8.2 Início e média

- início da série = **primeiro semestre com CHS > 0**;
- média histórica = média dos semestres do intervalo início..último (com semestres vazios como 0).

## 8.3 Carga faltante usada

Prioridade:

1. resumo oficial (`Obrigatórias.missing + Optativas.missing + Eletivas.missing`);
2. fallback interno (soma `bucket.missingCHT`).

No dashboard atual:

- `missingChtOverride` recebe o total faltante já filtrado por categoria ativa.

## 8.4 Projeção futura

- ritmo projetado = CHS alvo do usuário (ou média histórica);
- alocação por semestre em décimos para evitar semestre final com 0;
- término = último semestre projetado com CHS > 0.

---

## 9) Planejamento de grade (GradeNaHora)

Arquivo: `src/lib/integrations/gradenahora-scheduler.ts`

### 9.1 Semestre base

- tenta semestre atual;
- em erro (404 etc), recua semestre a semestre até achar oferta.

### 9.2 Combinações de turma

- backtracking limitado:
  - até 6 disciplinas na busca combinatória
  - até 20 combinações retornadas
- evita conflito de horário por código de slot.

### 9.3 Plano automático por períodos

Entrada:

- pendências + CHS alvo por período.

Regra:

1. seleciona disciplinas elegíveis (pré-requisitos já resolvidos no conjunto restante);
2. preenche período sem estourar meta (quando possível);
3. tenta turma sem conflito;
4. fallback mínimo quando não encontra combinação ideal.

### 9.4 Pendência com CHEXT no planejamento

Regra aplicada:

- no planejamento, cada pendência passa por `normalizePlannerPendingWithoutChext`:
  - `cht efetivo = max(cht - chext, 0)`;
  - se virar 0, item sai da carga do plano.

---

## 10) Convalidação em “Não Utilizadas”

Fluxo:

1. auto-sugestão por nome normalizado;
2. usuário define categoria destino e CHT a convalidar;
3. destino:
   - lookup por código/nome;
   - ou criação manual (`manualOnly`);
4. recálculo completo do roadmap.

Regras importantes:

- o aluno pode convalidar parcialmente (ex.: 45h de uma disciplina de 60h);
- quando parcial, destino pode continuar pendente;
- convalidação manual sem código existe para casos sem disciplina equivalente na matriz ativa.
