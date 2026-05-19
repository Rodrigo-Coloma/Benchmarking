# syntax=docker/dockerfile:1.7
#
# Multi-stage build del api-server (V3 §4.3). Construye desde la raíz del
# monorepo: `docker build -f artifacts/api-server/Dockerfile .` o vía
# docker-compose con `context: ..`.

# ---------- 1. deps ----------
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Manifests primero para maximizar el cache de capas.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json ./
COPY artifacts/api-server/package.json    artifacts/api-server/
COPY artifacts/web/package.json           artifacts/web/
COPY lib/db/package.json                  lib/db/
COPY lib/api-spec/package.json            lib/api-spec/
COPY lib/api-zod/package.json             lib/api-zod/
COPY lib/api-client-react/package.json    lib/api-client-react/

RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..."

# ---------- 2. build ----------
FROM deps AS build
COPY tsconfig.json ./
COPY lib lib
COPY artifacts/api-server artifacts/api-server
RUN pnpm --filter @workspace/api-server run build

# ---------- 3. runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Sólo el bundle + node_modules necesarios.
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/artifacts/api-server/package.json ./package.json

# Usuario no-root.
USER node

EXPOSE 8080

# Healthcheck integrado (lo invoca compose también).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://localhost:8080${BASE_PATH:-}/api/healthz" || exit 1

CMD ["node", "--enable-source-maps", "dist/index.mjs"]
