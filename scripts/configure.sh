#!/usr/bin/env bash
# Создаёт .env: случайный пароль БД и адрес сервера для HTTPS. Существующий .env не трогает.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  echo ".env уже есть"
  exit 0
fi
password="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
port="${POSTGRES_PORT:-55433}"
# IP, через который сервер выходит в сеть, — по нему ТСД и компьютеры будут открывать SkladNO.
ip_address="${SKLADNO_IP:-$(ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || true)}"
ip_address="${ip_address:-127.0.0.1}"
cat > .env <<EOF
POSTGRES_PASSWORD=${password}
POSTGRES_PORT=${port}
DATABASE_URL=postgres://skladno:${password}@127.0.0.1:${port}/skladno
BIND=127.0.0.1:8090
# HTTPS: IP сервера в сети фермы и необязательные имена через пробел (если есть DNS), например skladno.local
SKLADNO_IP=${ip_address}
SKLADNO_NAMES=
EOF
chmod 600 .env
echo ".env создан. IP сервера для HTTPS: ${ip_address}"
echo "Если IP не тот (проверьте: ip -4 addr), исправьте SKLADNO_IP в .env."
