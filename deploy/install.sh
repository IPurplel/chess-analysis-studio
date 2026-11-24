#!/usr/bin/env bash
# Chess Analysis Studio — one-shot installer for a Debian/Ubuntu LXC or VM (Proxmox).
# Run as root from the project folder:   bash deploy/install.sh
# Options (environment):  STUDIO_IMAGE=ghcr.io/...:latest  pull a prebuilt image instead of building
#                         AUTO_UPDATE=0                    do not install the automatic update timer
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "شغّل السكريبت كـ root (sudo bash deploy/install.sh)"; exit 1; fi
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
[ -f Dockerfile ] || { echo "لم أجد Dockerfile؛ شغّل السكريبت من داخل مجلد المشروع."; exit 1; }

echo "==> [1/5] تثبيت Docker (إن لم يكن موجودًا)"
if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends ca-certificates curl util-linux
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

# remember the image choice for the update script / timer
if [ -n "${STUDIO_IMAGE:-}" ]; then echo "STUDIO_IMAGE=${STUDIO_IMAGE}" > .env; fi

export BUILD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
echo "==> [2/5] بناء الصورة (يحمّل Stockfish الرسمي ويتحقق من بصمته) وتشغيل الخدمة"
if [ -n "${STUDIO_IMAGE:-}" ]; then $DC pull && $DC up -d; else $DC up -d --build; fi

echo "==> [3/5] انتظار جاهزية الخدمة"
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "${ok:-0}" = 1 ] || { echo "الخدمة لم تبدأ. السجلات:"; $DC logs --tail 50; exit 1; }

echo "==> [4/5] التحديث التلقائي"
if [ "${AUTO_UPDATE:-1}" = 1 ] && [ -d .git ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  cat > /etc/systemd/system/chess-studio-update.service <<EOF
[Unit]
Description=Update Chess Analysis Studio from GitHub
After=docker.service network-online.target

[Service]
Type=oneshot
WorkingDirectory=${ROOT}
ExecStart=/bin/bash ${ROOT}/deploy/update.sh
StandardOutput=append:/var/log/chess-studio-update.log
StandardError=append:/var/log/chess-studio-update.log
EOF
  cat > /etc/systemd/system/chess-studio-update.timer <<EOF
[Unit]
Description=Check GitHub for a new Chess Analysis Studio version

[Timer]
OnBootSec=3min
OnUnitActiveSec=10min
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now chess-studio-update.timer >/dev/null
  echo "    مفعّل: يفحص GitHub كل 10 دقائق ويحدّث تلقائيًا ويحذف النسخ القديمة. السجل: /var/log/chess-studio-update.log"
  echo "    لإيقافه: systemctl disable --now chess-studio-update.timer"
else
  echo "    تخطّيت التحديث التلقائي (AUTO_UPDATE=0 أو لا يوجد systemd/git). للتحديث يدويًا: bash deploy/update.sh"
fi

IP=$(hostname -I | awk '{print $1}')
echo "==> [5/5] جاهز"
echo
echo "    افتح من أي جهاز على الشبكة:  http://${IP}:3000"
echo "    تحديث يدوي فوري:             bash ${ROOT}/deploy/update.sh"
echo "    السجلات:                     $DC logs -f"
