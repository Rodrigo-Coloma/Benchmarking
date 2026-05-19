#!/usr/bin/env bash
# Backup diario del Postgres (V3 §6). Lo invoca el systemd timer.
# Mantiene 14 días de retención local. Opcionalmente puede sincronizar a R2
# con rclone (descomentar la línea final).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-/home/rcoloma/Benchmarking/deploy/docker-compose.yml}"

STAMP=$(date -u +"%Y%m%dT%H%M%SZ")
FILE="$BACKUP_DIR/assetmanager_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "→ dump → $FILE"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U assetmanager assetmanager \
  | gzip -9 > "$FILE"

# Rotación
find "$BACKUP_DIR" -name "assetmanager_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
echo "→ rotación: archivos > $RETENTION_DAYS días eliminados"

SIZE=$(du -h "$FILE" | cut -f1)
echo "✓ Backup completado: $FILE ($SIZE)"

# Opcional: sync a R2.
# rclone copy "$FILE" r2:benchmarking-backups/postgres/
