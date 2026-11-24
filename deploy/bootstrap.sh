#!/usr/bin/env bash
# One-line install/update on a Debian/Ubuntu container or VM (run as root). The project lands in ~/chess-analysis-studio.
#   curl -fsSL https://raw.githubusercontent.com/IPurplel/chess-analysis-studio/main/deploy/bootstrap.sh | bash
# Optional: STUDIO_IMAGE=ghcr.io/ipurplel/chess-analysis-studio:latest  (pull the prebuilt image instead of building)
set -euo pipefail

REPO="${STUDIO_REPO:-IPurplel/chess-analysis-studio}"
DIR="${STUDIO_DIR:-$HOME/chess-analysis-studio}"   # in your home folder, easy to find
OLD=/opt/chess-analysis-studio

if [ "$(id -u)" -ne 0 ]; then echo "شغّل الأمر كـ root."; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends git curl ca-certificates

# one-time move from the old location (data lives in a Docker volume, so nothing is lost)
if [ ! -d "$DIR/.git" ] && [ -d "$OLD/.git" ] && [ "$OLD" != "$DIR" ]; then
  echo "نقل المشروع من $OLD إلى $DIR"
  systemctl disable --now chess-studio-update.timer >/dev/null 2>&1 || true
  ( cd "$OLD" && { docker compose down || docker-compose down; } ) >/dev/null 2>&1 || true
  mv "$OLD" "$DIR"
fi

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "https://github.com/${REPO}.git" "$DIR"
fi
exec bash "$DIR/deploy/install.sh"
