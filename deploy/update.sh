#!/usr/bin/env bash
# Update to the latest version from GitHub, restart, and clean up old images.
#   bash deploy/update.sh            update only if there is something new (or the last attempt failed)
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
GOOD_FILE=.last-good      # commit that last started successfully
FAIL_FILE=.fail-count     # "<commit> <attempts>" for the commit that keeps failing

if [ -d .git ]; then
  git fetch -q origin main
  if ! git merge-base --is-ancestor HEAD origin/main; then log "تعذّر السحب (تعديلات محلية؟). لم يتغير شيء."; exit 1; fi
  git merge --ff-only -q origin/main
fi
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo none)"

# "up to date" means the *running* version is this commit, not merely that the files were pulled:
# a build that failed earlier must be retried (but at most 3 times per commit).
if [ "${1:-}" != "--force" ] && [ "$HEAD_SHA" = "$(cat "$GOOD_FILE" 2>/dev/null || true)" ]; then
  log "لا توجد تحديثات."
  exit 0
fi
if [ "${1:-}" != "--force" ] && [ -f "$FAIL_FILE" ] && read -r sha n < "$FAIL_FILE" && [ "$sha" = "$HEAD_SHA" ] && [ "${n:-0}" -ge 3 ]; then
  log "فشل بناء ${HEAD_SHA:0:7} ثلاث مرات؛ لن أعيد المحاولة حتى تصدر نسخة جديدة (أو شغّل --force)."
  exit 0
fi
log "تحديث إلى ${HEAD_SHA:0:7}"

# Keep exactly one previous image so a bad release can be rolled back.
if docker image inspect "$IMG" >/dev/null 2>&1; then docker tag "$IMG" chess-analysis-studio:previous; fi

build_ok=1
if [ -n "${STUDIO_IMAGE:-}" ]; then $DC pull && $DC up -d || build_ok=0; else $DC up -d --build || build_ok=0; fi

ok=0
if [ "$build_ok" = 1 ]; then
  # generous: a big database may take a while to open on a slow disk
  for _ in $(seq 1 120); do
    if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
fi

if [ "$ok" != 1 ]; then
  prev_n=0; if [ -f "$FAIL_FILE" ] && read -r sha n < "$FAIL_FILE" && [ "$sha" = "$HEAD_SHA" ]; then prev_n="${n:-0}"; fi
  echo "$HEAD_SHA $((prev_n + 1))" > "$FAIL_FILE"
  log "النسخة الجديدة لم تبدأ؛ رجوع للنسخة السابقة."
  $DC logs --tail 60 || true
  if docker image inspect chess-analysis-studio:previous >/dev/null 2>&1; then
    docker tag chess-analysis-studio:previous "$IMG"
    $DC up -d --no-build
  fi
  exit 1
fi

echo "$HEAD_SHA" > "$GOOD_FILE"
rm -f "$FAIL_FILE"

# Auto-remove what the update left behind: dangling (old, untagged) images and old build cache.
# Never touches volumes (your data) and never uses `-a`, so unrelated images on the host are safe.
docker image prune -f >/dev/null
docker builder prune -f --keep-storage 1GB >/dev/null 2>&1 || docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
log "تم التحديث إلى ${HEAD_SHA:0:7}. المساحة المستخدمة: $(docker system df --format '{{.Type}} {{.Size}}' | tr '\n' ';')"
