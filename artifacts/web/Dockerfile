# syntax=docker/dockerfile:1.7
#
# Build de Vite y servido con nginx:alpine. El bundle resultante asume
# `BASE_PATH=/evidencias/` en prod — se pasa por --build-arg.

# ---------- 1. build ----------
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json ./
COPY artifacts/api-server/package.json    artifacts/api-server/
COPY artifacts/web/package.json           artifacts/web/
COPY lib/db/package.json                  lib/db/
COPY lib/api-spec/package.json            lib/api-spec/
COPY lib/api-zod/package.json             lib/api-zod/
COPY lib/api-client-react/package.json    lib/api-client-react/

RUN pnpm install --frozen-lockfile --filter "@workspace/web..."

COPY tsconfig.json ./
COPY lib lib
COPY artifacts/web artifacts/web

ARG BASE_PATH=/evidencias/
ENV BASE_PATH=${BASE_PATH}

RUN pnpm --filter @workspace/web run build

# ---------- 2. runtime ----------
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/artifacts/web/dist /usr/share/nginx/html
COPY artifacts/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
