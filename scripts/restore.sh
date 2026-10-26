#!/usr/bin/env bash
# Восстановление БД из копии: scripts/restore.sh backups/skladno-....sql.gz
# Текущие данные будут заменены данными из копии.
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?Укажите файл копии, например backups/skladno-2026-11-02_0300.sql.gz}"
[[ -f "$file" ]] || { echo "Нет файла $file"; exit 1; }
read -r -p "Заменить текущие данные копией $file? Введите ДА: " answer
[[ "$answer" == "ДА" ]] || { echo "Отменено"; exit 1; }
docker compose stop app
gunzip -c "$file" | docker compose exec -T postgres psql -U skladno -d skladno -v ON_ERROR_STOP=1 -q
docker compose start app
echo "Восстановлено из $file"
