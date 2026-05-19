#!/usr/bin/env bash
# Smoke test post-deploy (V3 §10).
#   ./healthcheck.sh [BASE_URL]
# Default BASE_URL: https://rcoloma.dev/evidencias
set -euo pipefail

BASE="${1:-https://rcoloma.dev/evidencias}"

echo "→ API healthz"
curl -fsS "$BASE/api/healthz" | tee /dev/stderr | grep -q '"status":"ok"'

echo "→ Frontend index"
curl -fsS "$BASE/" | grep -q "<title>"

echo "✓ Deploy saludable"
