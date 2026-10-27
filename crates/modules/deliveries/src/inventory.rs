//! Реестр INDEX: все физические устройства из всех поставок — поиск, карточка с историей
//! изменений (SPEC: для устройств «когда, что изменилось, старое и новое значение») и правка
//! MAC и серийного номера.

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{
    AppError, AppResult, Db, audit,
    auth::{self, Role},
    text::{self, normalize_mac},
};
use uuid::Uuid;

const PAGE_MAX: i64 = 200;

pub fn router() -> Router<Db> {
    Router::new()
        .route("/inventory", get(list))
        .route("/inventory/{id}", get(detail).put(update))
}

const SELECT: &str = "SELECT v.id, v.device_index, v.mac_address, v.serial_no, v.destination, \
    m.manufacturer, m.model, m.hashrate_ths, m.power_w, c.name AS client_name, \
    d.id AS delivery_id, d.number AS delivery_number, d.delivery_date, d.stage, \
    skladno_address(md.number, mc.number, p.rack, p.shelf) AS location \
    FROM devices v JOIN device_models m ON m.id = v.model_id JOIN deliveries d ON d.id = v.delivery_id \
    JOIN clients c ON c.id = d.client_id LEFT JOIN device_placements p ON p.device_id = v.id \
    LEFT JOIN module_containers mc ON mc.id = p.module_container_id LEFT JOIN modules md ON md.id = mc.module_id";

/// Фильтры реестра: поиск по INDEX, MAC, серийному, модели, клиенту и поставке.
const WHERE: &str = "WHERE ($1::text IS NULL OR v.device_index ILIKE $1 OR v.mac_address ILIKE $1 \
       OR v.serial_no ILIKE $1 OR m.model ILIKE $1 OR m.manufacturer ILIKE $1 OR c.name ILIKE $1 OR d.number ILIKE $1) \
    AND ($2::text IS NULL OR v.destination = $2) \
    AND ($3::text IS NULL OR ($3 = 'placed') = (p.device_id IS NOT NULL))";

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct InventoryItem {
    id: Uuid,
    device_index: String,
    mac_address: Option<String>,
    serial_no: Option<String>,
    destination: String,
    manufacturer: String,
    model: String,
    hashrate_ths: Option<f64>,
    power_w: Option<i32>,
    client_name: String,
    delivery_id: Uuid,
    delivery_number: String,
    delivery_date: NaiveDate,
    stage: String,
    location: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    q: Option<String>,
    destination: Option<String>,
    /// placed | unplaced
    placement: Option<String>,
    #[serde(default)]
    offset: i64,
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct InventoryPage {
    items: Vec<InventoryItem>,
    total: i64,
    offset: i64,
    limit: i64,
}

async fn list(
    State(db): State<Db>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<InventoryPage>> {
    let limit = query.limit.unwrap_or(100).clamp(1, PAGE_MAX);
    let offset = query.offset.max(0);
    let pattern = text::like_pattern(query.q.as_deref());
    let destination = text::clean(query.destination);
    let placement = text::clean(query.placement).filter(|p| p == "placed" || p == "unplaced");

    let total = sqlx::query_scalar::<_, i64>(&format!(
        "SELECT count(*) FROM devices v JOIN device_models m ON m.id = v.model_id \
         JOIN deliveries d ON d.id = v.delivery_id JOIN clients c ON c.id = d.client_id \
         LEFT JOIN device_placements p ON p.device_id = v.id {WHERE}"
    ))
    .bind(&pattern)
    .bind(&destination)
    .bind(&placement)
    .fetch_one(&db)
    .await?;
    let items = sqlx::query_as::<_, InventoryItem>(&format!(
        "{SELECT} {WHERE} ORDER BY v.device_index LIMIT $4 OFFSET $5"
    ))
    .bind(&pattern)
    .bind(&destination)
    .bind(&placement)
    .bind(limit)
    .bind(offset)
    .fetch_all(&db)
    .await?;
    Ok(Json(InventoryPage {
        items,
        total,
        offset,
        limit,
    }))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct HistoryEntry {
    at: DateTime<Utc>,
    actor: String,
    action: String,
    changes: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct DeviceCard {
    #[serde(flatten)]
    item: InventoryItem,
    created_at: DateTime<Utc>,
    history: Vec<HistoryEntry>,
}

async fn fetch_item<'e, E: sqlx::PgExecutor<'e>>(
    executor: E,
    id: Uuid,
) -> AppResult<InventoryItem> {
    sqlx::query_as::<_, InventoryItem>(&format!("{SELECT} WHERE v.id = $1"))
        .bind(id)
        .fetch_optional(executor)
        .await?
        .ok_or_else(|| AppError::NotFound("Устройство не найдено".into()))
}

async fn detail(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<DeviceCard>> {
    let item = fetch_item(&db, id).await?;
    let created_at =
        sqlx::query_scalar::<_, DateTime<Utc>>("SELECT created_at FROM devices WHERE id = $1")
            .bind(id)
            .fetch_one(&db)
            .await?;
    let history = sqlx::query_as::<_, HistoryEntry>(
        "SELECT at, actor, action, changes FROM audit_log WHERE entity = 'device' AND entity_id = $1 ORDER BY at DESC, id DESC",
    )
    .bind(id)
    .fetch_all(&db)
    .await?;
    Ok(Json(DeviceCard {
        item,
        created_at,
        history,
    }))
}

#[derive(Debug, Deserialize)]
pub struct DeviceUpdate {
    mac_address: Option<String>,
    serial_no: Option<String>,
}

/// Ручная правка MAC и серийного номера. Пустое значение — очистить поле.
async fn update(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<DeviceUpdate>,
) -> AppResult<Json<DeviceCard>> {
    let mac = match text::clean(input.mac_address) {
        None => None,
        Some(raw) => Some(normalize_mac(&raw).map_err(AppError::Validation)?),
    };
    let serial = text::clean(input.serial_no);
    if serial.as_deref().is_some_and(|s| s.chars().count() > 100) {
        return Err(AppError::Validation(
            "Серийный номер длиннее 100 символов".into(),
        ));
    }

    let mut tx = db.begin().await?;
    let (old_mac, old_serial, stage) = sqlx::query_as::<_, (Option<String>, Option<String>, String)>(
        "SELECT v.mac_address, v.serial_no, d.stage FROM devices v JOIN deliveries d ON d.id = v.delivery_id \
         WHERE v.id = $1 FOR UPDATE OF v",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Устройство не найдено".into()))?;
    if stage == "closed" {
        auth::require(
            Role::Senior,
            "Изменение данных устройства закрытой поставки",
        )?;
    }
    if let Some(mac) = &mac {
        let owner = sqlx::query_scalar::<_, String>(
            "SELECT device_index FROM devices WHERE mac_address = $1 AND id <> $2 LIMIT 1",
        )
        .bind(mac)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(owner) = owner {
            return Err(AppError::Conflict(format!(
                "MAC {mac} уже записан у устройства {owner}"
            )));
        }
    }
    if mac != old_mac || serial != old_serial {
        sqlx::query("UPDATE devices SET mac_address = $2, serial_no = $3 WHERE id = $1")
            .bind(id)
            .bind(&mac)
            .bind(&serial)
            .execute(&mut *tx)
            .await?;
        let mut changes = audit::diff(
            &json!({ "mac_address": old_mac, "serial_no": old_serial }),
            &json!({ "mac_address": mac, "serial_no": serial }),
        );
        changes["device_index"] = json!(fetch_item(&mut *tx, id).await?.device_index);
        audit::record(&mut *tx, "device", id, "update", changes).await?;
    }
    tx.commit().await?;
    detail(State(db), Path(id)).await
}
