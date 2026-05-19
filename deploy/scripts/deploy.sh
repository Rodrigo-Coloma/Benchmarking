#!/usr/bin/env bash
# Aplica el último main a la instancia. Ejecutar como `rodrigo` desde el server.
#
# Pasos (V3 §7):
#   1. Build de las imágenes (api, worker, web) en el server.
#   2. Migraciones idempotentes.
#   3. Up rolling con healthcheck.
#   4. Limpieza de imágenes huérfanas.
#   5. Smoke healthcheck.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

COMPOSE=(docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml)

echo "→ build (api, worker, web)"
"${COMPOSE[@]}" build api worker web

echo "→ migraciones (idempotentes)"
"${COMPOSE[@]}" run --rm api node --enable-source-maps dist/migrate.mjs

echo "→ up rolling"
"${COMPOSE[@]}" up -d --remove-orphans

echo "→ limpieza de imágenes sueltas"
docker image prune -f >/dev/null || true

echo "→ healthcheck post-deploy"
sleep 5
"$ROOT_DIR/deploy/scripts/healthcheck.sh" "https://rcoloma.dev/evidencias"

REV=$(git rev-parse --short HEAD 2>/dev/null || echo "n/a")
echo "✓ Deploy completado: $REV"
