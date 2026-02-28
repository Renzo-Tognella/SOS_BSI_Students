# SaveStudents

Aplicação web para apoiar estudantes no planejamento acadêmico, leitura de histórico e sugestões de grade.

## Stack

- Next.js 15
- React 19
- TypeScript
- Vitest (testes)
- Integração opcional com LLMs (OpenRouter e Gemini)

## Pré-requisitos

- Node.js 20+ (recomendado)
- npm 10+ (ou compatível)

## Configuração completa do projeto

1. Instale as dependências:

```bash
npm install
```

2. Crie o arquivo de ambiente local:

```bash
cp .env.example .env
```

3. Preencha as variáveis no `.env` (detalhes abaixo).

4. Rode o projeto em desenvolvimento:

```bash
npm run dev
```

5. Acesse no navegador:

- `http://localhost:3000`

Observação: o comando `npm run dev` usa `scripts/dev-safe.cjs`, que encerra processos `next dev` antigos no mesmo projeto e limpa o cache `.next` antes de iniciar.

## Variáveis de ambiente

Arquivo: `.env`

```env
OPENROUTER_API_KEY=
OPENROUTER_MODEL=minimax/minimax-m2.5
OPENROUTER_REFERER=http://localhost:3000

GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash
```

### Quais são obrigatórias?

- Sem nenhuma chave: a API interna cai para um classificador local (regex).
- Com `OPENROUTER_API_KEY`: tenta OpenRouter primeiro.
- Se OpenRouter falhar ou não existir, e `GEMINI_API_KEY` existir: tenta Gemini.

Ordem atual no backend (`/api/assistant/chat`): `OpenRouter -> Gemini -> Rule-based`.

## Scripts úteis

- `npm run dev`: desenvolvimento (com limpeza segura de cache/processo)
- `npm run build`: build de produção
- `npm run start`: iniciar build de produção
- `npm run lint`: lint
- `npm run test`: testes em watch
- `npm run test:run`: testes uma vez
- `npm run test:coverage`: testes com cobertura

## Como usar o sistema (após instalar)

1. Inicie a aplicação com `npm run dev` e abra `http://localhost:3000`.
2. Na tela **Upload**, envie o PDF do seu **Histórico Completo** no campo de arquivo.
3. Clique em **Processar Histórico** para o sistema identificar disciplinas, matriz e progresso.
4. Vá para **Revisão** e confira se as disciplinas foram lidas corretamente.
5. Use **Planejamento** para montar os próximos períodos.
6. Acompanhe insights em **Dashboard**, **Grafo** e **Não Utilizadas**.
7. Para imprimir/baixar seus dados, use o botão **PDF** no topo da aplicação (canto superior direito).

### Onde encontrar o “Histórico Completo”

- No portal acadêmico da sua instituição (ex.: sistema do aluno), procure pela opção **Histórico Completo**.
- Baixe em **PDF** e envie esse arquivo no passo de upload.

## Como usar a API do Gemini via Google AI Studio

1. Acesse o Google AI Studio: [https://ai.google.dev/aistudio](https://ai.google.dev/aistudio)
2. Faça login com sua conta Google.
3. Vá em API Keys e crie uma chave para um projeto.
4. Copie a chave e defina no `.env`:

```env
GEMINI_API_KEY=sua_chave_aqui
GEMINI_MODEL=gemini-1.5-flash
```

5. Reinicie o servidor (`npm run dev`) para carregar a nova variável.

Referências oficiais:

- [Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)
- [Gemini API quickstart](https://ai.google.dev/gemini-api/docs/quickstart)
- [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing)

## Segurança

- Nunca commite `.env` no Git.
- Não exponha `GEMINI_API_KEY` no frontend.
- Use a chave apenas no backend (como já está implementado em `src/app/api/assistant/chat/route.ts`).

## Deploy na Railway (com OCR nativo)

Este projeto já está preparado para Railway com `Dockerfile` e inclui:
- `pdftotext` / `pdftoppm` (`poppler-utils`)
- `tesseract` + idioma `por`

### 1. Pré-requisito no repositório

- Garanta que os arquivos estejam versionados:
  - `Dockerfile`
  - `.dockerignore`

### 2. Criar projeto na Railway

1. Acesse [Railway](https://railway.app/), faça login e clique em **New Project**.
2. Selecione **Deploy from GitHub Repo**.
3. Escolha este repositório.
4. A Railway vai detectar o `Dockerfile` e buildar a imagem automaticamente.

### 3. Configurar variáveis de ambiente

No serviço da Railway, vá em **Variables** e configure (conforme seu uso):

```env
OPENROUTER_API_KEY=
OPENROUTER_MODEL=minimax/minimax-m2.5
OPENROUTER_REFERER=https://SEU_DOMINIO_RAILWAY

GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-flash
```

Observações:
- Não é necessário definir `PORT`; a Railway injeta automaticamente.
- O container já inicia com `next start -H 0.0.0.0 -p $PORT`.

### 4. Healthcheck e validação

Depois do deploy:
1. Abra a URL gerada pela Railway.
2. Teste os endpoints:
   - `GET /api/roadmap/lookup-disciplines`
   - `POST /api/roadmap/parse` com histórico real em PDF
   - `POST /api/roadmap/calculate`
3. Verifique logs para confirmar que não há erro de OCR/binários.

### 5. Domínio: preciso ter?

Não. Você pode usar sem domínio próprio.

- A Railway fornece um domínio padrão `*.up.railway.app`.
- Domínio customizado é opcional (apenas se você quiser URL própria).
