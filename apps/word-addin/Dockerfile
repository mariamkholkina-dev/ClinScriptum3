# Multi-stage build for word-addin: vite build → nginx serve.
#
# Word add-in is loaded by Office over HTTPS; production deploy needs TLS
# termination в reverse-proxy выше (nginx-proxy / Traefik / cloudflare).
# Этот image раздаёт static dist на 80 порту, проброс на 3001 в compose.

# ──────── Stage 1: build ────────
# Используем Debian-based slim вместо alpine — npm ci с optional native deps
# (rollup-linux-x64-musl) на Alpine не работает из-за npm bug (#4828):
# musl-варианты не подтягиваются автоматом. На Debian gnu-варианты ставятся
# из package-lock без проблем.
FROM node:20-slim AS builder

WORKDIR /app

# Копируем lockfile + workspace package.json'ы для эффективного кеша.
COPY package.json package-lock.json* ./
COPY apps/word-addin/package.json ./apps/word-addin/

# turbo требует full workspace для resolution path'ов даже при build одного app'а.
COPY tsconfig.base.json ./

RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# Копируем исходники word-addin
COPY apps/word-addin ./apps/word-addin

# Native binary Rollup для Linux glibc (Debian). Без него vite падает на
# MODULE_NOT_FOUND даже если ставится через npm ci — известный npm bug.
RUN npm install --no-save --no-audit --no-fund \
    @rollup/rollup-linux-x64-gnu \
    @emnapi/core \
    @emnapi/runtime || true

WORKDIR /app/apps/word-addin

# API URL зашивается в bundle на этапе build. Передавай через docker-compose
# build-arg, иначе add-in после деплоя будет стучаться на localhost:4000
# (внутри Word'а пользователя — где API нет → "Failed to fetch").
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ──────── Stage 2: serve ────────
FROM nginx:alpine AS runner

# Build arg: публичный URL по которому Office будет грузить add-in.
# По умолчанию — dev-server `localhost:3001`, для prod передавать через
# `--build-arg WORD_ADDIN_PUBLIC_URL=https://word-addin.dev.clinscriptum.ru`.
ARG WORD_ADDIN_PUBLIC_URL=https://localhost:3001

# Custom nginx config: SPA fallback + CORS for Office.js cross-origin
COPY apps/word-addin/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/apps/word-addin/dist /usr/share/nginx/html

# Manifest должен раздаваться как application/xml. Office проверяет content-type.
# При prod build заменяем localhost URL на публичный (через ARG).
COPY --from=builder /app/apps/word-addin/manifest.xml /usr/share/nginx/html/manifest.xml
RUN sed -i "s|https://localhost:3001|${WORD_ADDIN_PUBLIC_URL}|g" /usr/share/nginx/html/manifest.xml

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
