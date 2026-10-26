#!/usr/bin/env bash
# Резервная копия: БД в backups/skladno-ГГГГ-ММ-ДД_ЧЧММ.sql.gz и файлы документов поставок
# в backups/skladno-files-ГГГГ-ММ-ДД_ЧЧММ.tar.gz. Хранит последние 30 копий каждого вида.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp="$(date +%F_%H%M)"
file="backups/skladno-${stamp}.sql.gz"
docker compose exec -T postgres pg_dump -U skladno -d skladno --clean --if-exists | gzip > "$file"
echo "Копия БД: $file"
if docker compose ps --status running --services | grep -qx app; then
  files="backups/skladno-files-${stamp}.tar.gz"
  docker compose exec -T app tar -cz -C /srv/skladno files > "$files"
  echo "Копия файлов: $files"
fi
ls -1t backups/skladno-2*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm --
ls -1t backups/skladno-files-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm --
