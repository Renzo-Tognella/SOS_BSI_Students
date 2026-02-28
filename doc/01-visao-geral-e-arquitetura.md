# Visão Geral e Arquitetura

## Stack

- Next.js 15 (App Router)
- React 19
- TypeScript
- Chart.js + react-chartjs-2
- TanStack Query
- Framer Motion + Lucide React
- Vitest

## Arquitetura em alto nível

Fluxo principal:

1. Usuário envia PDF do histórico na tela de Upload.
2. API `/api/roadmap/parse` extrai texto e monta `ParsedTranscript`.
3. API `/api/roadmap/calculate` executa `calculateRoadmap` e retorna `RoadmapResult`.
4. Front-end renderiza dashboard, grafo, planejamento e não utilizadas a partir de `RoadmapResult`.
5. Planejamento consulta GradeNaHora via `/api/grade/options`.
6. Assistente de grade usa `/api/assistant/chat` para sugerir/aplicar plano.
7. Exportações via toolbar:
   - JSON local (client-side)
   - PDF via `/api/report/pdf`.

## Organização de rotas

As rotas visuais do app ficam em `src/app/(roadmap)`:

- `/` -> seção Upload
- `/dashboard` -> seção Dashboard
- `/grafo` -> seção Grafo
- `/grade` -> seção Planejamento
- `/revisao` -> seção Revisão
- `/nao-utilizadas` -> seção Não Utilizadas
- `/assistente` -> redireciona para `/grade`

Todas renderizam o mesmo workspace principal:

- `src/components/roadmap/roadmap-workspace.tsx`

O shell visual compartilhado é:

- `src/components/roadmap/layout/roadmap-shell.tsx`
- sidebar desktop + bottom nav mobile + topbar com ações.

## Módulos de domínio principais

- `src/lib/parser/historico-parser.ts`: parsing do PDF/texto do histórico.
- `src/lib/domain/matriz-engine.ts`: cálculo principal do roadmap.
- `src/lib/domain/graduation-forecast.ts`: projeção CHS/semestre e auditoria.
- `src/lib/integrations/gradenahora-scheduler.ts`: oferta de turmas e plano automático.
- `src/lib/domain/dashboard-visual-mappers.ts`: transforma dados em view-models do dashboard.

## Estruturas centrais de dados

Tipagem em:

- `src/types/academic.ts`
- `src/types/dashboard.ts`

Objetos principais:

- `ParsedTranscript`: histórico parseado
- `RoadmapResult`: resultado de progresso/pendências/grafo
- `GradeOptionsResponse`: oferta + combinações + plano de grade
- `GraduationForecast`: série histórica/projeção de CHS

## Persistência local (front-end)

O estado do workspace é salvo em `localStorage`:

- chave `roadmap_workspace_state_v2`:
  - histórico parseado, roadmap, plano manual, filtros, mensagens do assistente e ajustes de convalidação.
- chave `roadmap_workspace_export_state_v1`:
  - habilitação de botões JSON/PDF e estado de geração de PDF.

## Decisão arquitetural importante

O sistema usa uma única fonte de cálculo (`calculateRoadmap`) e reaproveita esse resultado em todas as telas.
Isso reduz divergência entre dashboard/planner/grafo, e toda mudança de convalidação ou filtro dispara recálculo/rerender com o mesmo resultado-base.
