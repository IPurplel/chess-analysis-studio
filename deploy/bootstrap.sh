#!/usr/bin/env bash
# One-line install on a fresh Debian/Ubuntu container or VM (run as root):
#   curl -fsSL https://raw.githubusercontent.com/IPurplel/chess-analysis-studio/main/deploy/bootstrap.sh | bash
# Optional: STUDIO_IMAGE=ghcr.io/ipurplel/chess-analysis-studio:latest  (pull the prebuilt image instead of building)
set -euo pipefail

REPO="${STUDIO_REPO:-IPurplel/chess-analysis-studio}"
DIR="${STUDIO_DIR:-/opt/chess-analysis-studio}"

if [ "$(id -u)" -ne 0 ]; then echo "شغّل الأمر كـ root."; exit 1; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends git curl ca-certificates

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "https://github.com/${REPO}.git" "$DIR"
fi
exec bash "$DIR/deploy/install.sh"
