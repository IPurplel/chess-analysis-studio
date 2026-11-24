#!/usr/bin/env bash
# Rebuild and restart after you copy new project files over the old ones. Data (the /data volume) is kept.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .git ] && git pull --ff-only
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
if [ -n "${STUDIO_IMAGE:-}" ]; then $DC pull && $DC up -d; else $DC up -d --build; fi
$DC ps
