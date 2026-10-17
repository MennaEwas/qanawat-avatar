#!/usr/bin/env bash
# One-shot deploy for the Qanawat Concierge (avatar.qanawat.ai).
# Run ON the server (erp.qanawat.ai) from the repo's deploy/ directory:
#
#   cd /home/ubuntu/qanawat-playground/deploy
#   cp .env.example .env && nano .env      # paste the 3 LiveKit values
#   bash deploy.sh
#
# Safe to re-run. Assumes: Docker + docker compose, host nginx, certbot present.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
DOMAIN="avatar.qanawat.ai"
NGINX_AVAIL="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

echo "==> 1/5  Checking prerequisites"
command -v docker >/dev/null || { echo "docker missing"; exit 1; }
docker compose version >/dev/null || { echo "docker compose plugin missing"; exit 1; }
[ -f .env ] || { echo "ERROR: create deploy/.env from .env.example first"; exit 1; }
grep -q 'livekit.cloud' .env || echo "WARN: NEXT_PUBLIC_LIVEKIT_URL in .env doesn't look set"

echo "==> 2/5  Building and starting containers"
docker compose up -d --build
docker compose ps

echo "==> waiting for web on 127.0.0.1:3002 ..."
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/ || true)
  [ "$code" = "200" ] && { echo "web is up ($code)"; break; }
  sleep 2
done

echo "==> 3/5  Installing nginx vhost for ${DOMAIN}"
if [ ! -f /etc/nginx/conf.d/ws_upgrade.conf ] && ! sudo nginx -T 2>/dev/null | grep -q 'connection_upgrade'; then
  echo 'map $http_upgrade $connection_upgrade { default upgrade; "" close; }' \
    | sudo tee /etc/nginx/conf.d/ws_upgrade.conf >/dev/null
fi
sudo cp "${DOMAIN}.nginx" "$NGINX_AVAIL"
sudo ln -sf "$NGINX_AVAIL" "$NGINX_ENABLED"
sudo nginx -t
sudo systemctl reload nginx

echo "==> 4/5  TLS certificate"
if sudo test -d "/etc/letsencrypt/live/${DOMAIN}"; then
  echo "cert already present, skipping certbot"
else
  if host "${DOMAIN}" >/dev/null 2>&1; then
    sudo certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
      -m "qanawat.ai@gmail.com" --redirect || \
      echo "certbot failed — run 'sudo certbot --nginx -d ${DOMAIN}' once DNS resolves"
  else
    echo "SKIP: ${DOMAIN} does not resolve yet. After adding the DNS A record, run:"
    echo "      sudo certbot --nginx -d ${DOMAIN}"
  fi
fi

echo "==> 5/5  Status"
docker compose ps
echo
echo "Agent log (last 15 lines):"
docker compose logs --tail 15 agent || true
echo
echo "Done. Once DNS + cert are in place, open: https://${DOMAIN}"
