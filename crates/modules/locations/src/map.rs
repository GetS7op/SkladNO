//! F-09 карта местоположений и приём сканированием (штрихкод полки + INDEX), F-06 сводка по складам.

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{AppError, AppResult, Db, audit, text};
use uuid::Uuid;

use skladno_core::settings::address_separator;

use crate::{address::Address, warehouse_label};

pub fn router() -> Router<Db> {
    Router::new()
        .route("/map", get(map))
        .route("/map/shelf", get(shelf))
        .route("/placements", post(place))
        .route("/warehouses", get(warehouses))
}

// ---------- Карта ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
struct MapInstance {
    module_id: Uuid,
    module_number: i32,
    location: Option<String>,
    warehouse: String,
    id: Uuid,
    number: i32,
    name: String,
    short_name: String,
    racks: i32,
    shelves_per_rack: i32,
    devices_per_shelf: i32,
    power_kw: f64,
    load_w: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ShelfCount {
    module_container_id: Uuid,
    rack: i32,
    shelf: i32,
    count: i64,
}

#[derive(Debug, Serialize)]
struct MapResponse {
    instances: Vec<MapInstance>,
    shelves: Vec<ShelfCount>,
}

#[derive(Debug, Deserialize)]
struct MapQuery {
    warehouse: Option<String>,
}

async fn map(State(db): State<Db>, Query(query): Query<MapQuery>) -> AppResult<Json<MapResponse>> {
    let warehouse = text::clean(query.warehouse);
    let instances = sqlx::query_as::<_, MapInstance>(
        "SELECT m.id AS module_id, m.number AS module_number, m.location, m.warehouse, mc.id, mc.number, \
         c.name, c.short_name, c.racks, c.shelves_per_rack, c.devices_per_shelf, c.power_kw, \
         COALESCE((SELECT sum(mo.power_w) FROM device_placements p JOIN devices d ON d.id = p.device_id \
                   JOIN device_models mo ON mo.id = d.model_id WHERE p.module_container_id = mc.id), 0)::bigint AS load_w \
         FROM modules m JOIN module_containers mc ON mc.module_id = m.id JOIN containers c ON c.id = mc.container_id \
         WHERE ($1::text IS NULL OR m.warehouse = $1) ORDER BY m.number, mc.number",
    )
    .bind(&warehouse)
    .fetch_all(&db)
    .await?;
    let shelves = sqlx::query_as::<_, ShelfCount>(
        "SELECT p.module_container_id, p.rack, p.shelf, count(*) AS count FROM device_placements p \
         JOIN module_containers mc ON mc.id = p.module_container_id JOIN modules m ON m.id = mc.module_id \
         WHERE ($1::text IS NULL OR m.warehouse = $1) GROUP BY 1, 2, 3",
    )
    .bind(&warehouse)
    .fetch_all(&db)
    .await?;
    Ok(Json(MapResponse { instances, shelves }))
}

// ---------- Полка ----------

#[derive(Debug, sqlx::FromRow)]
struct Target {
    module_container_id: Uuid,
    warehouse: String,
    racks: i32,
    shelves_per_rack: i32,
    devices_per_shelf: i32,
    power_kw: f64,
}

/// Находит полку по адресу и проверяет, что стеллаж и полка есть в шаблоне контейнера.
/// В транзакции приёма экземпляр контейнера блокируется: размещения в него идут по одному.
async fn resolve<'e, E: sqlx::PgExecutor<'e>>(
    executor: E,
    address: &Address,
    lock: bool,
) -> AppResult<Target> {
    let lock_clause = if lock {
        " FOR UPDATE OF mc FOR SHARE OF c, m"
    } else {
        ""
    };
    let target = sqlx::query_as::<_, Target>(&format!(
        "SELECT mc.id AS module_container_id, m.warehouse, c.racks, c.shelves_per_rack, c.devices_per_shelf, c.power_kw \
         FROM modules m JOIN module_containers mc ON mc.module_id = m.id AND mc.number = $2 \
         JOIN containers c ON c.id = mc.container_id WHERE m.number = $1{lock_clause}"
    ))
    .bind(address.module)
    .bind(address.container)
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| {
        AppError::NotFound(format!(
            "Полка {address} не найдена: нет модуля №{} или в нём нет контейнера №{}",
            address.module, address.container
        ))
    })?;
    if address.rack > target.racks || address.shelf > target.shelves_per_rack {
        return Err(AppError::NotFound(format!(
            "Полка {address} не найдена: в контейнере {} стеллажей по {} полок",
            target.racks, target.shelves_per_rack
        )));
    }
    Ok(target)
}

#[derive(Debug, Deserialize)]
struct ShelfQuery {
    code: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ShelfDevice {
    device_index: String,
    manufacturer: String,
    model: String,
    delivery_number: String,
}

#[derive(Debug, Serialize)]
struct ShelfResponse {
    address: String,
    warehouse: String,
    capacity: i32,
    devices: Vec<ShelfDevice>,
}

async fn shelf(
    State(db): State<Db>,
    Query(query): Query<ShelfQuery>,
) -> AppResult<Json<ShelfResponse>> {
    let separator = address_separator(&db).await?;
    let address = Address::parse(&query.code, &separator).map_err(AppError::Validation)?;
    let target = resolve(&db, &address, false).await?;
    let devices = sqlx::query_as::<_, ShelfDevice>(
        "SELECT d.device_index, mo.manufacturer, mo.model, del.number AS delivery_number FROM device_placements p \
         JOIN devices d ON d.id = p.device_id JOIN device_models mo ON mo.id = d.model_id \
         JOIN deliveries del ON del.id = d.delivery_id \
         WHERE p.module_container_id = $1 AND p.rack = $2 AND p.shelf = $3 ORDER BY d.device_index",
    )
    .bind(target.module_container_id)
    .bind(address.rack)
    .bind(address.shelf)
    .fetch_all(&db)
    .await?;
    Ok(Json(ShelfResponse {
        address: address.to_string(),
        warehouse: target.warehouse,
        capacity: target.devices_per_shelf,
        devices,
    }))
}

// ---------- Приём сканированием ----------

#[derive(Debug, Deserialize)]
struct PlaceInput {
    shelf_code: String,
    device_index: String,
}

#[derive(Debug, sqlx::FromRow)]
struct ScannedDevice {
    id: Uuid,
    device_index: String,
    destination: String,
    stage: String,
    delivery_id: Uuid,
    delivery_number: String,
    manufacturer: String,
    model: String,
    power_w: Option<i32>,
}

#[derive(Debug, sqlx::FromRow)]
struct CurrentPlacement {
    module_container_id: Uuid,
    rack: i32,
    shelf: i32,
    address: String,
}

#[derive(Debug, Serialize)]
struct PlaceResult {
    address: String,
    device_index: String,
    manufacturer: String,
    model: String,
    delivery_id: Uuid,
    delivery_number: String,
    /// Прежний адрес, если устройство перенесли с другой полки.
    moved_from: Option<String>,
    /// true — устройство уже стояло на этой полке (повторный скан ничего не меняет).
    unchanged: bool,
    shelf_count: i64,
    shelf_capacity: i32,
}

/// Index со сканера: 7 цифр. Короткий номер дополняется нулями, лишние пробелы убираются.
fn normalize_index(raw: &str) -> AppResult<String> {
    let value = raw.trim();
    if value.is_empty() || value.len() > 7 || !value.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::Validation(format!(
            "«{value}» не похоже на INDEX устройства (7 цифр)"
        )));
    }
    Ok(format!("{value:0>7}"))
}

async fn place(
    State(db): State<Db>,
    Json(input): Json<PlaceInput>,
) -> AppResult<Json<PlaceResult>> {
    let separator = address_separator(&db).await?;
    let address = Address::parse(&input.shelf_code, &separator).map_err(AppError::Validation)?;
    let device_index = normalize_index(&input.device_index)?;

    let mut tx = db.begin().await?;
    let target = resolve(&mut *tx, &address, true).await?;

    let device = sqlx::query_as::<_, ScannedDevice>(
        "SELECT d.id, d.device_index, d.destination, del.stage, del.id AS delivery_id, del.number AS delivery_number, \
         mo.manufacturer, mo.model, mo.power_w FROM devices d JOIN deliveries del ON del.id = d.delivery_id \
         JOIN device_models mo ON mo.id = d.model_id WHERE d.device_index = $1 FOR UPDATE OF d",
    )
    .bind(&device_index)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Устройство с INDEX {device_index} не найдено")))?;

    if device.stage != "receiving" {
        return Err(AppError::Conflict(format!(
            "Поставка {} не на этапе «Приём поставки» — размещение сканированием сейчас недоступно",
            device.delivery_number
        )));
    }
    if device.destination != target.warehouse {
        return Err(AppError::Conflict(format!(
            "Устройство {} предназначено для склада «{}», а полка {address} — в складе «{}»",
            device.device_index,
            warehouse_label(&device.destination),
            warehouse_label(&target.warehouse)
        )));
    }

    let current = sqlx::query_as::<_, CurrentPlacement>(
        "SELECT p.module_container_id, p.rack, p.shelf, \
         skladno_address(m.number, mc.number, p.rack, p.shelf) AS address \
         FROM device_placements p JOIN module_containers mc ON mc.id = p.module_container_id \
         JOIN modules m ON m.id = mc.module_id WHERE p.device_id = $1 FOR UPDATE OF p",
    )
    .bind(device.id)
    .fetch_optional(&mut *tx)
    .await?;
    let unchanged = current.as_ref().is_some_and(|c| {
        c.module_container_id == target.module_container_id
            && c.rack == address.rack
            && c.shelf == address.shelf
    });

    if !unchanged {
        let on_shelf = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM device_placements WHERE module_container_id = $1 AND rack = $2 AND shelf = $3",
        )
        .bind(target.module_container_id)
        .bind(address.rack)
        .bind(address.shelf)
        .fetch_one(&mut *tx)
        .await?;
        if on_shelf >= target.devices_per_shelf as i64 {
            return Err(AppError::Conflict(format!(
                "Полка {address} заполнена: {on_shelf} из {}",
                target.devices_per_shelf
            )));
        }

        // Мощность контейнера — жёсткий предел: суммарное потребление размещённых устройств.
        let load_w = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(sum(mo.power_w), 0)::bigint FROM device_placements p JOIN devices d ON d.id = p.device_id \
             JOIN device_models mo ON mo.id = d.model_id WHERE p.module_container_id = $1 AND p.device_id <> $2",
        )
        .bind(target.module_container_id)
        .bind(device.id)
        .fetch_one(&mut *tx)
        .await?;
        let new_load = load_w + device.power_w.unwrap_or(0) as i64;
        if new_load as f64 > target.power_kw * 1000.0 {
            return Err(AppError::Conflict(format!(
                "Превышена мощность контейнера: {:.2} из {} кВт после размещения",
                new_load as f64 / 1000.0,
                target.power_kw
            )));
        }

        sqlx::query(
            "INSERT INTO device_placements (device_id, module_container_id, rack, shelf) VALUES ($1, $2, $3, $4) \
             ON CONFLICT (device_id) DO UPDATE SET module_container_id = EXCLUDED.module_container_id, \
             rack = EXCLUDED.rack, shelf = EXCLUDED.shelf, placed_at = now()",
        )
        .bind(device.id)
        .bind(target.module_container_id)
        .bind(address.rack)
        .bind(address.shelf)
        .execute(&mut *tx)
        .await?;

        let new_address = address.to_string();
        let action = if current.is_some() { "move" } else { "place" };
        audit::record(
            &mut *tx,
            "device",
            device.id,
            action,
            json!({
                "device_index": device.device_index,
                "location": { "old": current.as_ref().map(|c| &c.address), "new": new_address },
            }),
        )
        .await?;
    }

    let shelf_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM device_placements WHERE module_container_id = $1 AND rack = $2 AND shelf = $3",
    )
    .bind(target.module_container_id)
    .bind(address.rack)
    .bind(address.shelf)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Json(PlaceResult {
        address: address.to_string(),
        device_index: device.device_index,
        manufacturer: device.manufacturer,
        model: device.model,
        delivery_id: device.delivery_id,
        delivery_number: device.delivery_number,
        moved_from: current.filter(|_| !unchanged).map(|c| c.address),
        unchanged,
        shelf_count,
        shelf_capacity: target.devices_per_shelf,
    }))
}

// ---------- F-06. Склады ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
struct WarehouseSummary {
    warehouse: String,
    modules: i64,
    containers: i64,
    capacity: i64,
    power_kw: f64,
    devices: i64,
    placed: i64,
    load_w: i64,
}

async fn warehouses(State(db): State<Db>) -> AppResult<Json<Vec<WarehouseSummary>>> {
    let rows = sqlx::query_as::<_, WarehouseSummary>(
        "WITH caps AS ( \
           SELECT m.warehouse, count(DISTINCT m.id) AS modules, count(mc.id) AS containers, \
             COALESCE(sum(c.racks * c.shelves_per_rack * c.devices_per_shelf), 0)::bigint AS capacity, \
             COALESCE(sum(c.power_kw), 0)::float8 AS power_kw \
           FROM modules m LEFT JOIN module_containers mc ON mc.module_id = m.id \
           LEFT JOIN containers c ON c.id = mc.container_id GROUP BY m.warehouse), \
         devs AS ( \
           SELECT d.destination AS warehouse, count(*) AS devices, count(p.device_id) AS placed, \
             COALESCE(sum(mo.power_w) FILTER (WHERE p.device_id IS NOT NULL), 0)::bigint AS load_w \
           FROM devices d JOIN device_models mo ON mo.id = d.model_id \
           LEFT JOIN device_placements p ON p.device_id = d.id GROUP BY d.destination) \
         SELECT w.warehouse, COALESCE(caps.modules, 0) AS modules, COALESCE(caps.containers, 0) AS containers, \
           COALESCE(caps.capacity, 0) AS capacity, COALESCE(caps.power_kw, 0) AS power_kw, \
           COALESCE(devs.devices, 0) AS devices, COALESCE(devs.placed, 0) AS placed, COALESCE(devs.load_w, 0) AS load_w \
         FROM (VALUES ('park'), ('workshop')) AS w(warehouse) \
         LEFT JOIN caps USING (warehouse) LEFT JOIN devs USING (warehouse)",
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

#[cfg(test)]
mod tests {
    use super::normalize_index;

    #[test]
    fn index_from_scanner() {
        assert_eq!(normalize_index(" 9000001 ").unwrap(), "9000001");
        assert_eq!(normalize_index("42").unwrap(), "0000042");
        assert!(normalize_index("12345678").is_err());
        assert!(normalize_index("1X2X3X4").is_err());
        assert!(normalize_index("").is_err());
    }
}
