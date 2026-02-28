# Features por Tela

## 1) Upload (`/`)

Arquivo: `src/components/roadmap/roadmap-workspace.tsx`

O que faz:

- recebe PDF do histórico;
- detecta matriz automaticamente (ou permite trocar manualmente 806/981);
- processa parse + cálculo do roadmap;
- mostra resumo inicial (aluno, curso, matriz detectada, total parseado, blocos não parseados).

Ações principais:

- `Processar Histórico`
- troca de matriz via seletor (recalcula tudo)

---

## 2) Revisão de Parse (`/revisao`)

O que faz:

- mostra tabela de disciplinas parseadas (código, nome, CHT, média, frequência, status, seção de origem);
- permite override manual de categoria de cálculo para disciplinas aprovadas (Obrigatória, Optativa, Trilha, Eletiva, etc.);
- mostra blocos não parseados para auditoria manual.

Objetivo:

- dar transparência do parse e corrigir classificação antes de planejar.

---

## 2.1) Correlação Manual de Disciplinas (subseção da Revisão)

O que faz:

- lista aprovações que ficaram sem match na matriz ativa;
- sugere destinos por código/nome;
- permite informar destino manualmente;
- aplica recálculo com as correlações.

Objetivo:

- absorver diferenças entre matrizes antigas e novas.

---

## 3) Dashboard (`/dashboard`)

### 3.1 Filtro de categorias nos cálculos

- categorias ligáveis/desligáveis:
  - Obrigatórias, Optativas, Trilhas, Eletivas, Complementares, Estágio, TCC, Extensão, Outras.
- o filtro altera todas as visualizações dependentes de carga:
  - cards de métricas
  - gráficos
  - projeção CHS
  - tabela final de faltantes
  - roadmap por período

### 3.2 Hero (CourseAtmosphere) + QuickStats + Próxima Aula

- progresso global;
- streak;
- próxima milestone;
- faltante oficial (CHT/CHS);
- média/variação, matérias concluídas, horas acumuladas;
- próxima aula baseada na agenda planejada.

### 3.3 Gráficos

- barras de CHT validada x faltante por setor;
- linha de ritmo CHS por semestre (histórico + projeção);
- auditoria da projeção (oficial vs interno);
- roadmap gigante por período com cartões, anel percentual e heatmap por seção.

### 3.4 Tabelas de detalhamento

- detalhamento por setor (status por disciplina);
- detalhamento de optativas por submódulo:
  - segundo estrato
  - trilhas
  - humanidades
- tabela final de horas faltantes (por setor + total).

### 3.5 Lista completa de matérias

- ordena por prioridade de planejamento:
  - em andamento/disponível/bloqueada/concluída;
- mostra status visual, pré-requisitos, nota e mini-sparkline;
- suporta Focus Mode.

---

## 4) Grafo de Pré-requisitos (`/grafo`)

O que faz:

- mostra contadores de status (DONE, AVAILABLE, BLOCKED, OUTSIDE_SCOPE);
- tabela de nós com pré-requisitos e dependentes.

Objetivo:

- leitura rápida de dependências para destravar o plano.

---

## 5) Planejador de Grade (`/grade`)

### 5.1 Filtros e escopo do plano

- reaproveita filtro de categorias de cálculo;
- seletor de trilhas:
  - selecionar iniciadas
  - selecionar todas
  - seleção manual por trilha

### 5.2 Geração automática do plano

- define CHS alvo por período;
- carrega oferta mais recente do GradeNaHora para BSI Curitiba (fallback de semestre);
- calcula plano sugerido por períodos.

### 5.3 Edição manual drag-and-drop

- coluna de disciplinas disponíveis;
- colunas por período;
- drag-and-drop entre origem e períodos;
- remoção de cards;
- resumo e agenda do período selecionado (tabela + grade semanal).

### 5.4 Auditoria da oferta

- tabela de oferta GradeNaHora (código, disciplina, CHS, turmas);
- bloco de avisos da integração (ex.: semestres indisponíveis).

### 5.5 Assistente de Grade (widget IA)

- chat acoplado ao planejamento;
- interpreta restrições do aluno;
- gera até 3 propostas por período (turmas/códigos/horários) com relatório de restrições;
- pergunta período quando o usuário não informa período alvo;
- aplica mudança no plano manual somente ao clicar em `Aplicar proposta`.

---

## 6) Disciplinas Não Utilizadas (`/nao-utilizadas`)

### 6.1 Convalidação por linha

Para cada disciplina não utilizada:

- mostra correspondência sugerida;
- permite escolher categoria de destino;
- permite definir CHT a convalidar;
- destino por lookup (código + nome + curso + matriz);
- alternativa de criação manual (sem código da matriz);
- botão `Convalidar` por linha.

### 6.2 Convalidação em lote

- botão `Convalidar Todas as Correspondências` para aplicar lote.

### 6.3 Transparência de carga eletiva

- mostra evidências de eletivas no histórico;
- mostra agregado “ELETIVAS” quando parse individual não fecha;
- exibe trechos brutos do PDF (sem parse) para auditoria manual.

---

## Topbar e ações globais

Arquivos:

- `src/components/roadmap/layout/roadmap-topbar.tsx`
- `src/components/roadmap/layout/roadmap-header-actions.tsx`

Ações:

- abrir assistente IA;
- exportar JSON;
- exportar PDF.

Os botões são habilitados/desabilitados de acordo com o estado do workspace salvo no browser.
