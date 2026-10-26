#!/usr/bin/env bash
# Резервная копия БД в backups/skladno-ГГГГ-ММ-ДД_ЧЧММ.sql.gz. Хранит последние 30 копий.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
file="backups/skladno-$(date +%F_%H%M).sql.gz"
docker compose exec -T postgres pg_dump -U skladno -d skladno --clean --if-exists | gzip > "$file"
ls -1t backups/skladno-*.sql.gz | tail -n +31 | xargs -r rm --
echo "Копия сохранена: $file"
