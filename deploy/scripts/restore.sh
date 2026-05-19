#!/usr/bin/env bash
# Restore desde un archivo `.sql.gz` producido por backup.sh.
# Uso:  ./restore.sh /var/backups/postgres/assetmanager_20260519T033000Z.sql.gz
#
# DESTRUCTIVO: dropea y recrea el schema. Pide confirmación explícita.
set -euo pipefail

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage: $0 <ruta_al_dump.sql.gz>" >&2
  exit 1
fi

COMPOSE_FILE="${COMPOSE_FILE:-/home/rodrigo/benchmarking/deploy/docker-compose.yml}"

read -rp "Vas a RESTAURAR $FILE sobre el Postgres actual. Escribe 'YES' para continuar: " ack
if [[ "$ack" != "YES" ]]; then
  echo "Cancelado"
  exit 1
fi

echo "→ drop schema public"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U assetmanager -d assetmanager -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "→ restore"
gunzip -c "$FILE" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U assetmanager -d assetmanager

echo "✓ Restore completado"
