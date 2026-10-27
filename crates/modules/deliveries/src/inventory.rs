//! Реестр INDEX («Главная»): все физические устройства из всех поставок — поиск по критериям
//! как в mf-old (номера, диапазоны, MAC, текст), сводка для плиток, карточка с историей
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
    search::{Criterion, DeviceSearch},
    text::{self, normalize_mac},
};
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

/// Все найденные строки отдаются разом, как в mf-old; предел защищает от случайной выгрузки миллиона.
const ROWS_MAX: i64 = 50_000;

pub fn router() -> Router<Db> {
    Router::new()
        .route("/inventory", get(list))
        .route("/inventory/stats", get(stats))
        .route("/inventory/{id}", get(detail).put(update))
}

const SELECT: &str = "SELECT v.id, v.device_index, v.mac_address, v.serial_no, v.destination, \
    (SELECT w.name FROM warehouses w WHERE w.code = v.destination) AS destination_name, \
    m.manufacturer, m.model, m.hashrate_ths, m.power_w, c.name AS client_name, \
    d.id AS delivery_id, d.number AS delivery_number, d.delivery_date, d.stage, \
    skladno_address(md.number, mc.number, p.rack, p.shelf) AS location \
    FROM devices v JOIN device_models m ON m.id = v.model_id JOIN deliveries d ON d.id = v.delivery_id \
    JOIN clients c ON c.id = d.client_id LEFT JOIN device_placements p ON p.device_id = v.id \
    LEFT JOIN module_containers mc ON mc.id = p.module_container_id LEFT JOIN modules md ON md.id = mc.module_id";

const FROM: &str = "FROM devices v JOIN device_models m ON m.id = v.model_id \
    JOIN deliveries d ON d.id = v.delivery_id JOIN clients c ON c.id = d.client_id \
    LEFT JOIN device_placements p ON p.device_id = v.id";

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct InventoryItem {
    id: Uuid,
    device_index: String,
    mac_address: Option<String>,
    serial_no: Option<String>,
    destination: String,
    destination_name: String,
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
    /// Все критерии на одном устройстве («и»); без него достаточно любого («или»).
    #[serde(default)]
    exact: bool,
    destination: Option<String>,
    /// placed | unplaced
    placement: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct InventoryList {
    items: Vec<InventoryItem>,
    total: i64,
    /// Что поняла строка поиска: «номера …; MAC …; текст …».
    summary: String,
}

/// Условия фильтров и поиска после WHERE.
fn push_filters(qb: &mut QueryBuilder<'_, Postgres>, query: &ListQuery, search: &DeviceSearch) {
    qb.push(" WHERE TRUE");
    if let Some(destination) = text::clean(query.destination.clone()) {
        qb.push(" AND v.destination = ").push_bind(destination);
    }
    match query.placement.as_deref() {
        Some("placed") => {
            qb.push(" AND p.device_id IS NOT NULL");
        }
        Some("unplaced") => {
            qb.push(" AND p.device_id IS NULL");
        }
        _ => {}
    }
    if search.is_empty() {
        return;
    }
    qb.push(" AND (");
    for (i, criterion) in search.criteria.iter().enumerate() {
        if i > 0 {
            qb.push(if query.exact { " AND " } else { " OR " });
        }
        match criterion {
            Criterion::Index(index) => {
                qb.push("v.device_index = ").push_bind(index.clone());
            }
            // INDEX — 7 цифр с ведущими нулями, поэтому строки сравниваются как числа.
            Criterion::Range(from, to) => {
                qb.push("v.device_index BETWEEN ")
                    .push_bind(from.clone())
                    .push(" AND ")
                    .push_bind(to.clone());
            }
            Criterion::Mac(mac) => {
                qb.push("v.mac_address = ").push_bind(mac.clone());
            }
            Criterion::Text(value) => {
                let pattern = text::like_pattern(Some(value)).unwrap_or_default();
                qb.push("(");
                let columns = [
                    "v.device_index",
                    "v.mac_address",
                    "v.serial_no",
                    "m.manufacturer",
                    "m.model",
                    "m.manufacturer || ' ' || m.model",
                    "c.name",
                    "d.number",
                    "d.device_group",
                ];
                for (j, column) in columns.iter().enumerate() {
                    if j > 0 {
                        qb.push(" OR ");
                    }
                    qb.push(format!("{column} ILIKE "))
                        .push_bind(pattern.clone());
                }
                qb.push(")");
            }
        }
    }
    qb.push(")");
}

async fn list(
    State(db): State<Db>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<InventoryList>> {
    let search = DeviceSearch::parse(query.q.as_deref().unwrap_or_default());

    let mut count = QueryBuilder::<Postgres>::new(format!("SELECT count(*) {FROM}"));
    push_filters(&mut count, &query, &search);
    let total = count.build_query_scalar::<i64>().fetch_one(&db).await?;

    let mut rows = QueryBuilder::<Postgres>::new(SELECT);
    push_filters(&mut rows, &query, &search);
    rows.push(" ORDER BY v.device_index LIMIT ")
        .push_bind(ROWS_MAX);
    let items = rows
        .build_query_as::<InventoryItem>()
        .fetch_all(&db)
        .await?;

    Ok(Json(InventoryList {
        items,
        total,
        summary: search.summary(query.exact),
    }))
}

#[derive(Debug, Deserialize)]
pub struct StatsQuery {
    destination: Option<String>,
}

/// Плитки над реестром: как на складе mf-old.
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct InventoryStats {
    devices: i64,
    clients: i64,
    models: i64,
    with_mac: i64,
    placed: i64,
}

async fn stats(
    State(db): State<Db>,
    Query(query): Query<StatsQuery>,
) -> AppResult<Json<InventoryStats>> {
    let row = sqlx::query_as::<_, InventoryStats>(
        "SELECT count(*) AS devices, count(DISTINCT d.client_id) AS clients, count(DISTINCT v.model_id) AS models, \
         count(v.mac_address) AS with_mac, count(p.device_id) AS placed \
         FROM devices v JOIN deliveries d ON d.id = v.delivery_id \
         LEFT JOIN device_placements p ON p.device_id = v.id \
         WHERE ($1::text IS NULL OR v.destination = $1)",
    )
    .bind(text::clean(query.destination))
    .fetch_one(&db)
    .await?;
    Ok(Json(row))
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
