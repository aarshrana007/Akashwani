#!/usr/bin/env bash
# One-shot setup on a fresh Ubuntu 22.04/24.04 VPS. Run as root:
#   curl -fsSL https://raw.githubusercontent.com/aarshrana007/Akashwani/main/deploy/deploy.sh | bash -s -- akashwani.example.com
# Afterwards: edit /opt/akashwani/backend/.env (LiveKit keys, SMTP), then:  cd /opt/akashwani/deploy && docker compose up -d --build
set -euo pipefail
DOMAIN="${1:?usage: deploy.sh your.domain.com}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq ca-certificates curl git ufw >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH >/dev/null; ufw allow 80 >/dev/null; ufw allow 443 >/dev/null; ufw --force enable >/dev/null
if [ -d /opt/akashwani/.git ]; then git -C /opt/akashwani pull -q; else git clone -q https://github.com/aarshrana007/Akashwani /opt/akashwani; fi
cd /opt/akashwani/deploy
mkdir -p data/files data/recordings
[ -f ../backend/.env ] || cp ../backend/.env.example ../backend/.env
echo "DOMAIN=$DOMAIN" > .env
docker compose up -d --build
cat <<MSG

Akashwani is starting at https://$DOMAIN  (HTTPS certificate is issued automatically once DNS points here).
Next:
  1. nano /opt/akashwani/backend/.env   → LIVEKIT_URL / KEY / SECRET, SMTP_*, APP_NAME
  2. cd /opt/akashwani/deploy && docker compose up -d --build
  3. To bring existing data: copy data.db, files/ and recordings/ into /opt/akashwani/deploy/data/ (stop first: docker compose stop app)
Update later:   cd /opt/akashwani && git pull && cd deploy && docker compose up -d --build
Logs:           cd /opt/akashwani/deploy && docker compose logs -f app
MSG
