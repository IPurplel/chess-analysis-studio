#!/usr/bin/env bash
# Chess Analysis Studio — one-shot installer for a Debian/Ubuntu LXC or VM (Proxmox).
# Run as root from the unpacked project folder:   bash deploy/install.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "شغّل السكريبت كـ root (sudo bash deploy/install.sh)"; exit 1; fi
cd "$(dirname "$0")/.."
[ -f Dockerfile ] || { echo "لم أجد Dockerfile؛ شغّل السكريبت من داخل مجلد المشروع."; exit 1; }

echo "==> [1/4] تثبيت Docker (إن لم يكن موجودًا)"
if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends ca-certificates curl
  # Prefer the distro packages; they work for Debian 12 and Ubuntu 22.04/24.04.
  apt-get install -y docker.io || { echo "تعذّر تثبيت docker.io"; exit 1; }
  apt-get install -y docker-compose-v2 2>/dev/null || apt-get install -y docker-compose-plugin 2>/dev/null || apt-get install -y docker-compose 2>/dev/null || true
fi
systemctl enable --now docker >/dev/null 2>&1 || service docker start || true

if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else echo "لم أجد docker compose. ثبّت docker-compose-v2 أو docker-compose-plugin ثم أعد التشغيل."; exit 1; fi

if ! docker info >/dev/null 2>&1; then
  cat <<'EOF'
Docker لا يعمل. إن كنت داخل LXC على Proxmox:
  على المضيف (Proxmox) نفّذ، حيث 101 رقم الحاوية:
    pct set 101 --features nesting=1,keyctl=1
    pct reboot 101
  ثم أعد تشغيل هذا السكريبت. (الأفضل: حاوية Unprivileged مع nesting.)
EOF
  exit 1
fi

echo "==> [2/4] بناء الصورة (يحمّل Stockfish الرسمي ويتحقق من بصمته) وتشغيل الخدمة"
if [ -n "${STUDIO_IMAGE:-}" ]; then $DC pull && $DC up -d; else $DC up -d --build; fi

echo "==> [3/4] انتظار جاهزية الخدمة"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "${ok:-0}" = 1 ] || { echo "الخدمة لم تبدأ. السجلات:"; $DC logs --tail 50; exit 1; }

IP=$(hostname -I | awk '{print $1}')
echo "==> [4/4] جاهز"
echo
echo "    افتح من أي جهاز على الشبكة:  http://${IP}:3000"
echo "    التحديث لاحقًا:              bash deploy/update.sh"
echo "    السجلات:                     $DC logs -f"
