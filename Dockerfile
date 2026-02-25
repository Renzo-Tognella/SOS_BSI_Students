FROM node:20-bookworm-slim AS base

WORKDIR /app

# OCR/tooling used by historico-parser.ts:
# - pdftotext / pdftoppm from poppler-utils
# - tesseract with Portuguese language pack
RUN apt-get update && apt-get install -y --no-install-recommends \
  poppler-utils \
  tesseract-ocr \
  tesseract-ocr-por \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app ./

EXPOSE 3000

# Railway injects PORT; keep a safe fallback for local docker run.
CMD ["sh", "-c", "npm run start -- -H 0.0.0.0 -p ${PORT:-3000}"]
