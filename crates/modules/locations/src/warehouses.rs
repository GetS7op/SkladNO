//! F-06. Склады: справочник (имя и маска INDEX) и сводка размещения и вместимости по каждому.
//! Маска — 7 знаков: префикс из цифр и X на месте счётчика (9XXXXXX → INDEX 9000000–9999999).
//! Диапазоны складов не пересекаются; маску после создания не меняют — по ней уже выданы INDEX.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, put},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{AppError, AppResult, Db, audit, auth, auth::Role, text};
use uuid::Uuid;

const INDEX_DIGITS: u32 = 7;
const DUPLICATE: &str = "Склад с таким именем уже есть";

pub fn router() -> Router<Db> {
    Router::new()
        .route("/warehouses", get(list).post(create))
        .route("/warehouses/{code}", put(rename))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Warehouse {
    code: String,
    name: String,
    index_mask: String,
    first_value: i32,
    next_value: i32,
    max_value: i32,
    modules: i64,
    containers: i64,
    capacity: i64,
    power_kw: f64,
    devices: i64,
    placed: i64,
    load_w: i64,
}

#[derive(Debug, Deserialize)]
pub struct WarehouseInput {
    name: String,
    index_mask: String,
}

#[derive(Debug, Deserialize)]
pub struct RenameInput {
    name: String,
}

/// Диапазон INDEX по маске: (маска в каноническом виде, первый, последний).
fn parse_mask(raw: &str) -> Result<(String, i32, i32), String> {
    // Сканер и раскладка могут дать кириллическую «Х» и строчные буквы.
    let mask: String = raw
        .trim()
        .chars()
        .map(|c| {
            if matches!(c, 'x' | 'Х' | 'х') {
                'X'
            } else {
                c
            }
        })
        .collect();
    let prefix: String = mask.chars().take_while(char::is_ascii_digit).collect();
    let counter = mask.chars().count() - prefix.len();
    let valid = mask.chars().count() == INDEX_DIGITS as usize
        && !prefix.is_empty()
        && counter > 0
        && mask[prefix.len()..].chars().all(|c| c == 'X');
    if !valid {
        return Err(format!(
            "Маска INDEX — {INDEX_DIGITS} знаков: сначала цифры склада, затем X на месте номера, например 1XXXXXX или 21XXXXX"
        ));
    }
    let span = 10_i32.pow(counter as u32);
    let first = prefix
        .parse::<i32>()
        .map_err(|_| "Неверный префикс маски".to_string())?
        * span;
    // INDEX 0000000 не выдаётся: нумерация начинается с 1.
    Ok((mask, first.max(1), first + span - 1))
}

fn clean_name(name: String) -> AppResult<String> {
    let name = text::clean(Some(name)).unwrap_or_default();
    if name.chars().count() < 2 {
        return Err(AppError::Validation(
            "Имя склада — не короче 2 символов".into(),
        ));
    }
    Ok(name)
}

const SUMMARY: &str = "WITH caps AS ( \
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
     SELECT w.code, w.name, w.index_mask, w.first_value, w.next_value, w.max_value, \
       COALESCE(caps.modules, 0) AS modules, COALESCE(caps.containers, 0) AS containers, \
       COALESCE(caps.capacity, 0) AS capacity, COALESCE(caps.power_kw, 0) AS power_kw, \
       COALESCE(devs.devices, 0) AS devices, COALESCE(devs.placed, 0) AS placed, COALESCE(devs.load_w, 0) AS load_w \
     FROM warehouses w LEFT JOIN caps ON caps.warehouse = w.code LEFT JOIN devs ON devs.warehouse = w.code";

async fn list(State(db): State<Db>) -> AppResult<Json<Vec<Warehouse>>> {
    let rows = sqlx::query_as::<_, Warehouse>(&format!("{SUMMARY} ORDER BY w.first_value"))
        .fetch_all(&db)
        .await?;
    Ok(Json(rows))
}

async fn fetch(db: &Db, code: &str) -> AppResult<Warehouse> {
    sqlx::query_as::<_, Warehouse>(&format!("{SUMMARY} WHERE w.code = $1"))
        .bind(code)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Склад не найден".into()))
}

async fn create(
    State(db): State<Db>,
    Json(input): Json<WarehouseInput>,
) -> AppResult<(StatusCode, Json<Warehouse>)> {
    auth::require(Role::Admin, "Создание склада")?;
    let name = clean_name(input.name)?;
    let (mask, first, max) = parse_mask(&input.index_mask).map_err(AppError::Validation)?;
    let code = format!("w{}", mask.trim_end_matches('X'));

    let mut tx = db.begin().await?;
    let overlapping = sqlx::query_as::<_, (String, String)>(
        "SELECT name, index_mask FROM warehouses \
         WHERE int4range(first_value, max_value, '[]') && int4range($1, $2, '[]') ORDER BY first_value",
    )
    .bind(first)
    .bind(max)
    .fetch_all(&mut *tx)
    .await?;
    if !overlapping.is_empty() {
        let list: Vec<String> = overlapping
            .iter()
            .map(|(n, m)| format!("«{n}» ({m})"))
            .collect();
        return Err(AppError::Conflict(format!(
            "Маска {mask} пересекается с диапазоном INDEX склада {}",
            list.join(", ")
        )));
    }
    sqlx::query(
        "INSERT INTO warehouses (code, name, index_mask, first_value, next_value, max_value) \
         VALUES ($1, $2, $3, $4, $4, $5)",
    )
    .bind(&code)
    .bind(&name)
    .bind(&mask)
    .bind(first)
    .bind(max)
    .execute(&mut *tx)
    .await
    .map_err(AppError::unique_as(DUPLICATE))?;
    audit::record(
        &mut *tx,
        "warehouse",
        Uuid::nil(),
        "create",
        json!({ "code": code, "name": name, "index_mask": mask }),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(fetch(&db, &code).await?)))
}

async fn rename(
    State(db): State<Db>,
    Path(code): Path<String>,
    Json(input): Json<RenameInput>,
) -> AppResult<Json<Warehouse>> {
    auth::require(Role::Admin, "Переименование склада")?;
    let name = clean_name(input.name)?;
    let mut tx = db.begin().await?;
    let before =
        sqlx::query_scalar::<_, String>("SELECT name FROM warehouses WHERE code = $1 FOR UPDATE")
            .bind(&code)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("Склад не найден".into()))?;
    sqlx::query("UPDATE warehouses SET name = $2, updated_at = now() WHERE code = $1")
        .bind(&code)
        .bind(&name)
        .execute(&mut *tx)
        .await
        .map_err(AppError::unique_as(DUPLICATE))?;
    audit::record(
        &mut *tx,
        "warehouse",
        Uuid::nil(),
        "update",
        json!({ "code": code, "name": { "old": before, "new": name } }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(fetch(&db, &code).await?))
}

/// Имя склада по коду — для понятных сообщений об ошибках.
pub(crate) async fn warehouse_name<'e, E: sqlx::PgExecutor<'e>>(
    executor: E,
    code: &str,
) -> AppResult<String> {
    Ok(
        sqlx::query_scalar::<_, String>("SELECT name FROM warehouses WHERE code = $1")
            .bind(code)
            .fetch_optional(executor)
            .await?
            .unwrap_or_else(|| code.to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::parse_mask;

    #[test]
    fn masks() {
        assert_eq!(
            parse_mask("9XXXXXX").unwrap(),
            ("9XXXXXX".into(), 9_000_000, 9_999_999)
        );
        assert_eq!(
            parse_mask(" 0xxxxxx ").unwrap(),
            ("0XXXXXX".into(), 1, 999_999)
        );
        assert_eq!(
            parse_mask("21ХХХХХ").unwrap(),
            ("21XXXXX".into(), 2_100_000, 2_199_999)
        );
        assert_eq!(
            parse_mask("123456X").unwrap(),
            ("123456X".into(), 1_234_560, 1_234_569)
        );
    }

    #[test]
    fn bad_masks() {
        for bad in [
            "XXXXXXX", "1234567", "1XXXXX", "1XXXXXXX", "1X2XXXX", "A1XXXXX", "",
        ] {
            assert!(parse_mask(bad).is_err(), "{bad}");
        }
    }
}
