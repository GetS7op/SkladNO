#!/usr/bin/env bash
# Проверка критериев приёмки SPEC через API на ПУСТОМ экземпляре SkladNO (до создания администратора).
# Создаёт тестовые данные, поэтому запускать только на тестовом стенде, не на рабочем сервере.
#
#   scripts/acceptance.sh                       # http://127.0.0.1:8090
#   scripts/acceptance.sh http://127.0.0.1:18090
#
# Нужны curl и jq. Код выхода — число проваленных проверок.
set -uo pipefail

BASE="${1:-http://127.0.0.1:8090}"
API="$BASE/api/v1"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
JAR="$WORK/admin.jar"
OP_JAR="$WORK/operator.jar"
FAILED=0

ok() { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILED=$((FAILED + 1)); }
# check <описание> <ожидаемое> <фактическое>
check() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1: ожидалось «$2», получено «$3»"; fi; }
uuid() { cat /proc/sys/kernel/random/uuid; }
# call <jar> <метод> <путь> [json] — печатает тело в $WORK/body, возвращает HTTP-код
call() {
  local jar=$1 method=$2 path=$3 data=${4:-}
  if [ -n "$data" ]; then
    curl -s -b "$jar" -c "$jar" -o "$WORK/body" -w '%{http_code}' -X "$method" \
      -H 'Content-Type: application/json' -d "$data" "$API$path"
  else
    curl -s -b "$jar" -c "$jar" -o "$WORK/body" -w '%{http_code}' -X "$method" "$API$path"
  fi
}
body() { jq -r "$1" "$WORK/body"; }

for _ in $(seq 1 60); do curl -sf "$API/health" >/dev/null && break; sleep 1; done
curl -sf "$API/health" >/dev/null || { echo "SkladNO не отвечает на $BASE"; exit 1; }

echo "== Вход и роли"
call "$JAR" GET /auth/status >/dev/null
if [ "$(body .needs_setup)" != "true" ]; then
  echo "Администратор уже создан: проверка работает только на пустом экземпляре."; exit 1
fi
PASS="Acc-$(uuid)"
profile() { # login, пароль
  printf '{"login":"%s","last_name":"Проверкин","first_name":"Тест","middle_name":"Тестович","email":"%s@example.test","password":"%s"}' "$1" "$1" "$2"
}
check "первый администратор" 201 "$(call "$JAR" POST /auth/setup "$(profile acc-admin "$PASS")")"
check "повторная настройка запрещена" 409 "$(call "$WORK/x.jar" POST /auth/setup "$(profile acc-admin2 "$PASS")")"
check "без входа — 401" 401 "$(call "$WORK/anon.jar" GET /devices)"
call "$JAR" POST /invites '{"role":"operator","days":1}' >/dev/null
TOKEN=$(body .path | sed 's#.*/##')
REG=$(profile acc-operator "$PASS" | jq -c --arg t "$TOKEN" '. + {token: $t}')
check "регистрация СА по приглашению" 201 "$(call "$OP_JAR" POST /auth/register "$REG")"
check "приглашение одноразовое" 404 "$(call "$WORK/y.jar" POST /auth/register "$(echo "$REG" | jq -c '.login="acc-op2"')")"

for _ in $(seq 1 10); do call "$WORK/z.jar" POST /auth/login '{"login":"acc-nobody","password":"wrong"}' >/dev/null; done
check "подбор пароля: 11-я попытка блокируется" 429 "$(call "$WORK/z.jar" POST /auth/login '{"login":"acc-nobody","password":"wrong"}')"

echo "== F-01. Реестр устройств"
code=$(call "$JAR" POST /devices '{"manufacturer":"Bitmain","model":"Antminer S21","hashrate_ths":200,"power_w":3550,"dimensions_mm":"400 195 290"}')
check "модель создана" 201 "$code"
M1=$(body .id)
check "габариты автоформатируются" "400x195x290" "$(body .dimensions_mm)"
check "дубликат модели (другой регистр) — 409" 409 "$(call "$JAR" POST /devices '{"manufacturer":"bitmain","model":"antminer s21"}')"
check "неполные габариты — 422" 422 "$(call "$JAR" POST /devices '{"manufacturer":"MicroBT","model":"M60","dimensions_mm":"400 195"}')"

echo "== F-02. Клиенты"
check "клиент создан" 201 "$(call "$JAR" POST /clients '{"name":"ООО Приёмка"}')"
C1=$(body .id)
check "дубликат клиента — 409" 409 "$(call "$JAR" POST /clients '{"name":"ооо приёмка"}')"

echo "== F-07, F-08. Контейнер и модули"
check "контейнер создан" 201 "$(call "$JAR" POST /containers '{"name":"Контейнер 20","short_name":"К20","power_kw":20,"racks":2,"shelves_per_rack":2,"devices_per_shelf":2}')"
CT=$(body .id)
check "модуль Парка" 201 "$(call "$JAR" POST /modules "{\"number\":1,\"warehouse\":\"park\",\"containers\":[{\"number\":1,\"container_id\":\"$CT\"}]}")"
check "модуль Мастерской" 201 "$(call "$JAR" POST /modules "{\"number\":2,\"warehouse\":\"workshop\",\"containers\":[{\"number\":1,\"container_id\":\"$CT\"}]}")"

echo "== F-06. Склады: справочник и маски INDEX"
check "СА не создаёт склад — 403" 403 "$(call "$OP_JAR" POST /warehouses '{"name":"Север","index_mask":"1XXXXXX"}')"
check "маска пересекается с Парком — 409" 409 "$(call "$JAR" POST /warehouses '{"name":"Север","index_mask":"0XXXXXX"}')"
check "неверная маска — 422" 422 "$(call "$JAR" POST /warehouses '{"name":"Север","index_mask":"1XX"}')"
check "склад «Север» с маской 1XXXXXX" 201 "$(call "$JAR" POST /warehouses '{"name":"Север","index_mask":"1xxxxxx"}')"
check "диапазон по маске" "1000000-1999999" "$(body '"\(.first_value)-\(.max_value)"')"
WH=$(body .code)
check "вложенная маска 12XXXXX — 409" 409 "$(call "$JAR" POST /warehouses '{"name":"Юг","index_mask":"12XXXXX"}')"
check "модуль на новом складе" 201 "$(call "$JAR" POST /modules "{\"number\":3,\"warehouse\":\"$WH\",\"containers\":[{\"number\":1,\"container_id\":\"$CT\"}]}")"
check "расположение модуля — имя склада" "Север" "$(body .warehouse_name)"

echo "== F-03. Поставки"
delivery() { # назначение, количество, request_id
  printf '{"request_id":"%s","client_id":"%s","delivery_date":"2026-10-27","destination":"%s","condition":"factory_new","lines":[{"model_id":"%s","quantity":%s}]}' "$3" "$C1" "$1" "$M1" "$2"
}
RID=$(uuid)
check "поставка в Парк" 201 "$(call "$JAR" POST /deliveries "$(delivery park 3 "$RID")")"
D1=$(body .id)
check "Index Парка с 0000001" "0000001 0000002 0000003" "$(body '[.devices[].device_index] | join(" ")')"
DEV1=$(body '.devices[0].id')
call "$JAR" POST /deliveries "$(delivery park 3 "$RID")" >/dev/null
check "повтор запроса не создаёт вторую поставку" "$D1" "$(body .id)"
check "поставка в Мастерскую" 201 "$(call "$JAR" POST /deliveries "$(delivery workshop 1 "$(uuid)")")"
check "Index Мастерской с 9000000" "9000000" "$(body '.devices[0].device_index')"
check "поставка на новый склад" 201 "$(call "$JAR" POST /deliveries "$(delivery "$WH" 2 "$(uuid)")")"
check "INDEX по маске склада" "1000000 1000001" "$(body '[.devices[].device_index] | join(" ")')"
check "имя склада в поставке" "Север" "$(body .destination_name)"

echo "== F-09. Размещение сканированием"
place() { call "$1" POST /placements "{\"shelf_code\":\"$2\",\"device_index\":\"$3\"}"; }
check "до этапа «Приём поставки» размещать нельзя" 409 "$(place "$OP_JAR" 1X1X1X1 0000001)"
check "СА переводит на «Приём поставки»" 200 "$(call "$OP_JAR" POST "/deliveries/$D1/advance" '{"expected_stage":"created"}')"
check "этап уже сменён — 409" 409 "$(call "$OP_JAR" POST "/deliveries/$D1/advance" '{"expected_stage":"created"}')"
check "СА размещает 0000001 на 1X1X2X1" 200 "$(place "$OP_JAR" 1X1X2X1 0000001)"
check "кириллическая «Х» в штрихкоде" 200 "$(place "$OP_JAR" 1Х1Х1Х1 0000002)"
check "полка чужого склада — 409" 409 "$(place "$OP_JAR" 2X1X1X1 0000003)"
check "несуществующая полка — ошибка" 404 "$(place "$OP_JAR" 1X1X9X1 0000003)"

echo "== F-07. Уменьшение занятого контейнера"
SHRINK='{"name":"Контейнер 20","short_name":"К20","power_kw":20,"racks":1,"shelves_per_rack":2,"devices_per_shelf":2}'
check "стеллажей меньше занятого — 409" 409 "$(call "$JAR" PUT "/containers/$CT" "$SHRINK")"
check "в ответе — затронутый INDEX" "true" "$(jq -r 'tostring | contains("0000001")' "$WORK/body")"

echo "== F-03. Подтверждение и закрытие"
check "СА не подтверждает поставку — 403" 403 "$(call "$OP_JAR" POST "/deliveries/$D1/advance" '{"expected_stage":"receiving"}')"
call "$JAR" GET "/deliveries/$D1/warnings" >/dev/null
check "предупреждение о неразмещённом устройстве" "true" "$(body '.warnings | tostring | contains("Не размещено устройств: 1 из 3")')"
check "подтверждение с предупреждениями проходит" 200 "$(call "$JAR" POST "/deliveries/$D1/advance" '{"expected_stage":"receiving"}')"
check "закрытие поставки" 200 "$(call "$JAR" POST "/deliveries/$D1/advance" '{"expected_stage":"confirmation"}')"
check "MAC в закрытой поставке СА не правит — 403" 403 "$(call "$OP_JAR" PUT "/inventory/$DEV1" '{"mac_address":"aa-bb-cc-00-00-01","serial_no":null}')"
check "Старший СА / администратор правит" 200 "$(call "$JAR" PUT "/inventory/$DEV1" '{"mac_address":"aa-bb-cc-00-00-01","serial_no":"SN1"}')"
check "MAC нормализован" "AA:BB:CC:00:00:01" "$(body .mac_address)"

echo "== Реестр INDEX, журнал, настройки"
call "$JAR" GET '/inventory?q=aabbcc000001' >/dev/null
check "поиск по MAC в любом написании" "0000001" "$(body '.items[0].device_index')"
call "$JAR" GET '/inventory?q=1-2%209000000' >/dev/null
check "диапазон и номер сразу" "0000001 0000002 9000000" "$(body '[.items[].device_index] | join(" ")')"
check "что понял поиск" "номера 0000001–0000002, 9000000" "$(body .summary)"
call "$JAR" GET '/inventory?q=1-3,%20SN1&exact=true' >/dev/null
check "точное совпадение — все критерии" "0000001" "$(body '[.items[].device_index] | join(" ")')"
call "$JAR" GET '/inventory/stats' >/dev/null
check "плитки: устройств и с MAC" "6 1" "$(body '"\(.devices) \(.with_mac)"')"
call "$JAR" GET "/inventory/$DEV1" >/dev/null
check "история устройства: размещение и правка" "true" "$(body '(.history | length) >= 2')"
check "СА не меняет настройки — 403" 403 "$(call "$OP_JAR" PUT /settings '{"address_separator":"-"}')"
check "разделитель «-»" 200 "$(call "$JAR" PUT /settings '{"address_separator":"-"}')"
call "$JAR" GET '/inventory?q=0000002' >/dev/null
check "адрес с новым разделителем" "1-1-1-1" "$(body '.items[0].location')"
check "старый штрихкод с X читается" 409 "$(place "$JAR" 2X1X1X1 0000002)"
call "$JAR" PUT /settings '{"address_separator":"X"}' >/dev/null

echo "== Статусы, отправки, комплектующие"
call "$JAR" GET /statuses >/dev/null
check "справочник статусов из mf-old" "8 16" "$(body '"\(.statuses | length) \(.transitions | length)"')"
st() { jq -r --arg n "$1" '.statuses[] | select(.name == $n) | .id' "$WORK/statuses.json"; }
cp "$WORK/body" "$WORK/statuses.json"
check "СА ставит первый статус" 200 "$(call "$OP_JAR" PUT "/inventory/$DEV1/status" "{\"status_id\":\"$(st 'В работе')\"}")"
check "СА — по матрице" 200 "$(call "$OP_JAR" PUT "/inventory/$DEV1/status" "{\"status_id\":\"$(st 'Требует ТО')\"}")"
check "СА — вне матрицы нельзя" 409 "$(call "$OP_JAR" PUT "/inventory/$DEV1/status" "{\"status_id\":\"$(st 'Донор')\"}")"
check "Старший СА — вне матрицы можно" 200 "$(call "$JAR" PUT "/inventory/$DEV1/status" "{\"status_id\":\"$(st 'Донор')\"}")"
check "отметка «вне матрицы»" "true" "$(body .outside_matrix)"
check "отправка устройств 1-2" 201 "$(call "$OP_JAR" POST /shipments '{"devices":"1-2","recipient":"Bitkern","packed_at":"2026-10-20","comment":"Ошибка J2:2"}')"
check "записаны обе" "0000001 0000002" "$(body '.created | join(" ")')"
call "$OP_JAR" POST /shipments '{"devices":"2","packed_at":"2026-10-21"}' >/dev/null
check "повторно упаковать нельзя" "0000002" "$(body '.blocked[0].device_index')"
call "$JAR" GET '/inventory?q=1' >/dev/null
check "упаковка ставит статус «Упакован»" "Упакован" "$(body '.items[0].status_name')"
call "$JAR" GET '/shipments?q=0000001' >/dev/null
SHIP=$(body '.[0].id')
call "$OP_JAR" PUT "/shipments/$SHIP" '{"recipient":"Bitkern","packed_at":"2026-10-20","shipped_at":"2026-10-22","arrived_at":"2026-10-26"}' >/dev/null
check "прибытие ставит «Ремонт»" "Ремонт" "$(body .shipment.status_name)"
call "$JAR" GET /shipments/stats >/dev/null
check "отправок и не вернулись" "2 1" "$(body '"\(.total) \(.open)"')"
check "позиция комплектующих" 201 "$(call "$JAR" POST /parts '{"name":"APW171215A"}')"
PART=$(body .id)
check "СА не заводит позиции — 403" 403 "$(call "$OP_JAR" POST /parts '{"name":"FAN-1"}')"
check "приход 5 шт." 204 "$(call "$OP_JAR" POST /part-receipts "{\"received_at\":\"2026-10-25\",\"lines\":[{\"part_id\":\"$PART\",\"quantity\":5}]}")"
check "установка 2 шт. в 0000001" 201 "$(call "$OP_JAR" POST /part-movements "{\"part_id\":\"$PART\",\"action\":\"installed\",\"quantity\":2,\"device_index\":\"1\"}")"
check "остаток 3" "3" "$(body .available)"
check "списать больше остатка нельзя" 409 "$(call "$OP_JAR" POST /part-movements "{\"part_id\":\"$PART\",\"action\":\"written_off\",\"quantity\":4}")"

echo "== Экспорт"
for registry in devices inventory clients deliveries pools workers containers modules shipments parts; do
  for format in csv xlsx md; do
    code=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$API/export/$registry?format=$format")
    [ "$code" = 200 ] || fail "экспорт $registry.$format: $code"
  done
done
ok "10 реестров × 3 формата"

echo
if [ "$FAILED" -eq 0 ]; then echo "Все проверки пройдены"; else echo "Провалено проверок: $FAILED"; fi
exit "$FAILED"
