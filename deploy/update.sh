#!/usr/bin/env bash
# Update to the latest version from GitHub, restart, and clean up old images.
#   bash deploy/update.sh            update only if GitHub has something new
#   bash deploy/update.sh --force    rebuild even if nothing changed
# Safe to run by hand or from the auto-update timer. Data (the /data volume) is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."

exec 9>/tmp/chess-studio-update.lock
flock -n 9 || { echo "تحديث آخر قيد التنفيذ."; exit 0; }

set -a; [ -f .env ] && . ./.env; set +a
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
IMG="${STUDIO_IMAGE:-chess-analysis-studio:latest}"
log() { echo "[$(date '+%F %T')] $*"; }

if [ -d .git ]; then
  git fetch -q origin main
  if [ "${1:-}" != "--force" ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
    log "لا توجد تحديثات."
    exit 0
  fi
  git pull --ff-only -q || { log "تعذّر السحب (تعديلات محلية؟). لم يتغير شيء."; exit 1; }
  log "تم سحب النسخة $(git rev-parse --short HEAD)"
fi

# Keep exactly one previous image so a bad release can be rolled back.
if docker image inspect "$IMG" >/dev/null 2>&1; then docker tag "$IMG" chess-analysis-studio:previous; fi

if [ -n "${STUDIO_IMAGE:-}" ]; then $DC pull && $DC up -d; else $DC up -d --build; fi

ok=0
for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done

if [ "$ok" != 1 ]; then
  log "النسخة الجديدة لم تبدأ؛ رجوع للنسخة السابقة."
  if docker image inspect chess-analysis-studio:previous >/dev/null 2>&1; then
    docker tag chess-analysis-studio:previous "$IMG"
    $DC up -d --no-build
  fi
  $DC logs --tail 40 || true
  exit 1
fi

# Auto-remove what the update left behind: dangling (old, untagged) images and old build cache.
# Never touches volumes (your data) and never uses `-a`, so unrelated images on the host are safe.
docker image prune -f >/dev/null
docker builder prune -f --keep-storage 1GB >/dev/null 2>&1 || docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
log "تم التحديث. المساحة المستخدمة: $(docker system df --format '{{.Type}} {{.Size}}' | tr '\n' ';')"
