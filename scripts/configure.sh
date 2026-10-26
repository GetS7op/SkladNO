#!/usr/bin/env bash
# Создаёт .env со случайным паролем БД. Существующий .env не трогает.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  echo ".env уже есть"
  exit 0
fi
password="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)"
port="${POSTGRES_PORT:-55433}"
cat > .env <<EOF
POSTGRES_PASSWORD=${password}
POSTGRES_PORT=${port}
DATABASE_URL=postgres://skladno:${password}@127.0.0.1:${port}/skladno
BIND=127.0.0.1:8090
EOF
chmod 600 .env
echo ".env создан"
