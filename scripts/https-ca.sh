#!/usr/bin/env bash
# Сохраняет корневой сертификат HTTPS (центр сертификации Caddy) в skladno-ca.crt и печатает его
# отпечаток SHA-256 — по нему на устройстве можно убедиться, что ставите именно этот сертификат.
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > skladno-ca.crt
echo "Корневой сертификат: $(pwd)/skladno-ca.crt"
echo "Его же можно скачать на устройстве: http://<адрес сервера>/ca.crt"
if command -v openssl >/dev/null; then
  openssl x509 -in skladno-ca.crt -noout -subject -enddate -fingerprint -sha256
fi
