#!/usr/bin/env bash
# Запуск backend с переменными из .env. Если frontend собран, он раздаётся с того же порта.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || scripts/configure.sh
set -a
source .env
set +a
if [[ -z "${STATIC_DIR:-}" && -f frontend/dist/index.html ]]; then
  export STATIC_DIR=frontend/dist
fi
exec cargo run --quiet -p skladno "$@"
