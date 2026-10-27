//! Шаблон поставки: выгрузка устройств поставки с колонками MAC и серийного номера и загрузка
//! заполненного шаблона обратно. Устройства сопоставляются по INDEX; пустая ячейка не стирает
//! прежнее значение. Каждое изменение пишется в журнал со старым и новым значением (SPEC).

use std::collections::HashMap;

use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query, State},
    http::header,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{
    AppError, AppResult, Db, audit,
    auth::{self, Role},
    text::normalize_mac,
};
use uuid::Uuid;

use crate::{
    import::{MAX_ROWS, RowError, header_index, read_rows},
    table::{self, Cell, ExportFormat, Table},
};

#[derive(sqlx::FromRow)]
struct DeviceRow {
    id: Uuid,
    device_index: String,
    manufacturer: String,
    model: String,
    mac_address: Option<String>,
    serial_no: Option<String>,
}

#[derive(sqlx::FromRow)]
struct DeliveryHead {
    number: String,
    stage: String,
}

async fn delivery_head(db: &Db, id: Uuid) -> AppResult<DeliveryHead> {
    sqlx::query_as::<_, DeliveryHead>("SELECT number, stage FROM deliveries WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Поставка не найдена".into()))
}

async fn delivery_devices<'e, E: sqlx::PgExecutor<'e>>(executor: E, id: Uuid) -> AppResult<Vec<DeviceRow>> {
    Ok(sqlx::query_as::<_, DeviceRow>(
        "SELECT v.id, v.device_index, m.manufacturer, m.model, v.mac_address, v.serial_no \
         FROM devices v JOIN device_models m ON m.id = v.model_id WHERE v.delivery_id = $1 ORDER BY v.device_index",
    )
    .bind(id)
    .fetch_all(executor)
    .await?)
}

#[derive(Deserialize)]
pub struct TemplateQuery {
    #[serde(default = "default_format")]
    format: String,
}

fn default_format() -> String {
    "xlsx".into()
}

/// GET /deliveries/{id}/template — шаблон для заполнения MAC и серийных номеров.
pub async fn template(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Query(query): Query<TemplateQuery>,
) -> AppResult<impl IntoResponse> {
    let format = ExportFormat::parse(&query.format)
        .filter(|f| *f != ExportFormat::Md)
        .ok_or_else(|| AppError::Validation("Шаблон: формат xlsx или csv".into()))?;
    let head = delivery_head(&db, id).await?;
    let devices = delivery_devices(&db, id).await?;
    let filled = devices.iter().filter(|d| d.mac_address.is_some()).count() as i64;
    let table = Table {
        title: format!("Поставка {} — данные устройств", head.number),
        file: format!("template-{}", head.number),
        columns: vec!["INDEX", "UUID", "Производитель", "Модель", "MAC", "Серийный номер"],
        rows: devices
            .into_iter()
            .map(|d| {
                vec![
                    d.device_index.into(),
                    d.id.to_string().into(),
                    d.manufacturer.into(),
                    d.model.into(),
                    d.mac_address.into(),
                    d.serial_no.into(),
                ]
            })
            .collect::<Vec<Vec<Cell>>>(),
        stats: vec![("С заполненным MAC".into(), filled.into())],
    };
    let generated = chrono::Local::now().format("%d.%m.%Y %H:%M").to_string();
    let body = match format {
        ExportFormat::Xlsx => table::to_xlsx(&table, &generated)
            .map_err(|e| AppError::Validation(format!("Не удалось собрать XLSX: {e}")))?,
        _ => table::to_csv(&table),
    };
    // Номер поставки кириллический — в имени файла его заменяет латинская транслитерация префикса.
    let filename = format!("skladno-shablon-{}.{}", head.number.replace("ПУ", "PU"), format.extension());
    Ok((
        [
            (header::CONTENT_TYPE, format.content_type().to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"")),
        ],
        body,
    ))
}

const COLUMNS: &[(&str, &[&str])] = &[
    ("index", &["index", "инвентарный номер", "индекс"]),
    ("mac", &["mac", "mac-адрес", "mac адрес"]),
    ("serial", &["серийный номер", "серийный", "serial", "sn", "s/n"]),
];

#[derive(Deserialize)]
pub struct ImportQuery {
    #[serde(default)]
    dry_run: bool,
}

#[derive(Serialize)]
pub struct DeviceDataReport {
    dry_run: bool,
    total: usize,
    /// Устройства, у которых изменились MAC или серийный номер.
    created: usize,
    /// Строки без изменений.
    skipped: usize,
    errors: Vec<RowError>,
}

/// POST /deliveries/{id}/devices/import — загрузка заполненного шаблона.
pub async fn import(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Query(query): Query<ImportQuery>,
    body: Bytes,
) -> AppResult<Json<DeviceDataReport>> {
    let head = delivery_head(&db, id).await?;
    if head.stage == "closed" {
        auth::require(Role::Senior, "Изменение данных устройств закрытой поставки")?;
    }
    if body.is_empty() {
        return Err(AppError::Validation("Файл пустой".into()));
    }
    let rows = read_rows(&body)?;
    let Some(header_pos) = rows.iter().position(|r| r.iter().any(|c| !c.is_empty())) else {
        return Err(AppError::Validation("В файле нет данных".into()));
    };
    let index = header_index(&rows[header_pos], COLUMNS);
    if !index.contains_key("index") {
        return Err(AppError::Validation("Нет колонки «INDEX» — используйте шаблон поставки".into()));
    }
    if !index.contains_key("mac") && !index.contains_key("serial") {
        return Err(AppError::Validation("Нет колонок «MAC» и «Серийный номер» — нечего загружать".into()));
    }
    let data: Vec<(usize, &Vec<String>)> = rows
        .iter()
        .enumerate()
        .skip(header_pos + 1)
        .filter(|(_, r)| r.iter().any(|c| !c.is_empty()))
        .map(|(i, r)| (i + 1, r))
        .collect();
    if data.len() > MAX_ROWS {
        return Err(AppError::Validation(format!("Не больше {MAX_ROWS} строк за одну загрузку")));
    }

    let mut tx = db.begin().await?;
    // Блокируем устройства поставки: две одновременные загрузки не перепишут друг друга.
    let devices = sqlx::query_as::<_, DeviceRow>(
        "SELECT v.id, v.device_index, m.manufacturer, m.model, v.mac_address, v.serial_no \
         FROM devices v JOIN device_models m ON m.id = v.model_id WHERE v.delivery_id = $1 FOR UPDATE OF v",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    let by_index: HashMap<&str, &DeviceRow> = devices.iter().map(|d| (d.device_index.as_str(), d)).collect();

    let mut report = DeviceDataReport { dry_run: query.dry_run, total: data.len(), created: 0, skipped: 0, errors: vec![] };
    let mut seen_macs: HashMap<String, usize> = HashMap::new();
    for (line, row) in data {
        let cell = |key: &str| index.get(key).and_then(|i| row.get(*i)).map(|v| v.trim()).unwrap_or("");
        let mut error = |message: String| report.errors.push(RowError { row: line, message });

        let raw_index = cell("index");
        let device_index = if raw_index.len() < 7 && raw_index.chars().all(|c| c.is_ascii_digit()) && !raw_index.is_empty() {
            format!("{raw_index:0>7}")
        } else {
            raw_index.to_string()
        };
        let Some(device) = by_index.get(device_index.as_str()) else {
            error(format!("INDEX «{raw_index}» не из этой поставки"));
            continue;
        };
        let mac = match cell("mac") {
            "" => None,
            raw => match normalize_mac(raw) {
                Ok(mac) => Some(mac),
                Err(message) => {
                    error(message);
                    continue;
                }
            },
        };
        let serial = match cell("serial") {
            "" => None,
            s if s.chars().count() > 100 => {
                error("Серийный номер длиннее 100 символов".into());
                continue;
            }
            s => Some(s.to_string()),
        };
        if let Some(mac) = &mac {
            if let Some(first) = seen_macs.insert(mac.clone(), line) {
                error(format!("MAC {mac} повторяется (уже в строке {first})"));
                continue;
            }
            let owner = sqlx::query_scalar::<_, String>(
                "SELECT device_index FROM devices WHERE mac_address = $1 AND id <> $2 LIMIT 1",
            )
            .bind(mac)
            .bind(device.id)
            .fetch_optional(&mut *tx)
            .await?;
            if let Some(owner) = owner {
                error(format!("MAC {mac} уже записан у устройства {owner}"));
                continue;
            }
        }

        let new_mac = mac.or_else(|| device.mac_address.clone());
        let new_serial = serial.or_else(|| device.serial_no.clone());
        if new_mac == device.mac_address && new_serial == device.serial_no {
            report.skipped += 1;
            continue;
        }
        sqlx::query("UPDATE devices SET mac_address = $2, serial_no = $3 WHERE id = $1")
            .bind(device.id)
            .bind(&new_mac)
            .bind(&new_serial)
            .execute(&mut *tx)
            .await?;
        let mut changes = audit::diff(
            &json!({ "mac_address": device.mac_address, "serial_no": device.serial_no }),
            &json!({ "mac_address": new_mac, "serial_no": new_serial }),
        );
        changes["device_index"] = json!(device.device_index);
        audit::record(&mut *tx, "device", device.id, "update", changes).await?;
        report.created += 1;
    }
    if query.dry_run {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }
    Ok(Json(report))
}
