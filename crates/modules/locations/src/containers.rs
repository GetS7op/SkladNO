//! F-07. Контейнеры (шаблоны). Параметры можно менять, но не так, чтобы размещённые устройства
//! оказались вне контейнера или сверх его мощности (Q-33: показываем затронутые устройства).

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, put},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_catalog::format_dimensions;
use skladno_core::{AppError, AppResult, Db, audit, text};
use uuid::Uuid;

const COLUMNS: &str = "c.id, c.name, c.short_name, c.power_kw, c.racks, c.shelves_per_rack, c.devices_per_shelf, \
    c.shelf_dims_mm, c.description, \
    (SELECT count(*) FROM module_containers mc WHERE mc.container_id = c.id) AS instances";

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Container {
    id: Uuid,
    name: String,
    short_name: String,
    power_kw: f64,
    racks: i32,
    shelves_per_rack: i32,
    devices_per_shelf: i32,
    shelf_dims_mm: Option<String>,
    description: Option<String>,
    instances: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ContainerFields {
    name: String,
    short_name: String,
    power_kw: f64,
    racks: i32,
    shelves_per_rack: i32,
    devices_per_shelf: i32,
    shelf_dims_mm: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ContainerInput {
    name: String,
    short_name: String,
    power_kw: f64,
    racks: i32,
    shelves_per_rack: i32,
    devices_per_shelf: i32,
    shelf_dims_mm: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    q: Option<String>,
}

pub fn router() -> Router<Db> {
    Router::new()
        .route("/containers", get(list).post(create))
        .route("/containers/{id}", put(update))
}

fn validate(input: ContainerInput) -> AppResult<ContainerFields> {
    let name = input.name.trim().to_string();
    let short_name = input.short_name.trim().to_string();
    if name.is_empty() || short_name.is_empty() {
        return Err(AppError::Validation("Укажите наименование и сокращение".into()));
    }
    if !input.power_kw.is_finite() || input.power_kw <= 0.0 {
        return Err(AppError::Validation("Мощность контейнера — число больше нуля, кВт".into()));
    }
    for (value, label) in [
        (input.racks, "Кол-во стеллажей"),
        (input.shelves_per_rack, "Кол-во полок"),
        (input.devices_per_shelf, "Кол-во устройств на полку"),
    ] {
        if !(1..=100).contains(&value) {
            return Err(AppError::Validation(format!("{label}: от 1 до 100")));
        }
    }
    let shelf_dims_mm = format_dimensions(input.shelf_dims_mm.as_deref())
        .map_err(|e| AppError::Validation(format!("Габариты полки: {e}")))?;
    Ok(ContainerFields {
        name,
        short_name,
        power_kw: input.power_kw,
        racks: input.racks,
        shelves_per_rack: input.shelves_per_rack,
        devices_per_shelf: input.devices_per_shelf,
        shelf_dims_mm,
        description: text::clean(input.description),
    })
}

const DUPLICATE: &str = "Контейнер с таким наименованием или сокращением уже есть";

async fn list(State(db): State<Db>, Query(query): Query<ListQuery>) -> AppResult<Json<Vec<Container>>> {
    let rows = sqlx::query_as::<_, Container>(&format!(
        "SELECT {COLUMNS} FROM containers c WHERE ($1::text IS NULL OR c.name ILIKE $1 OR c.short_name ILIKE $1) \
         ORDER BY lower(c.name)"
    ))
    .bind(text::like_pattern(query.q.as_deref()))
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

async fn fetch(db: &Db, id: Uuid) -> AppResult<Container> {
    sqlx::query_as::<_, Container>(&format!("SELECT {COLUMNS} FROM containers c WHERE c.id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Контейнер не найден".into()))
}

async fn create(
    State(db): State<Db>,
    Json(input): Json<ContainerInput>,
) -> AppResult<(StatusCode, Json<Container>)> {
    let f = validate(input)?;
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO containers (name, short_name, power_kw, racks, shelves_per_rack, devices_per_shelf, \
         shelf_dims_mm, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
    )
    .bind(&f.name)
    .bind(&f.short_name)
    .bind(f.power_kw)
    .bind(f.racks)
    .bind(f.shelves_per_rack)
    .bind(f.devices_per_shelf)
    .bind(&f.shelf_dims_mm)
    .bind(&f.description)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::unique_as(DUPLICATE))?;
    audit::record(&mut *tx, "container", id, "create", json!(f)).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(fetch(&db, id).await?)))
}

async fn update(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<ContainerInput>,
) -> AppResult<Json<Container>> {
    let f = validate(input)?;
    let mut tx = db.begin().await?;
    // Блокировка шаблона не даёт размещать устройства в его экземпляры, пока идёт проверка.
    let before = sqlx::query_as::<_, ContainerFields>(
        "SELECT name, short_name, power_kw, racks, shelves_per_rack, devices_per_shelf, shelf_dims_mm, description \
         FROM containers WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Контейнер не найден".into()))?;

    check_occupancy(&mut tx, id, &f).await?;

    sqlx::query(
        "UPDATE containers SET name = $2, short_name = $3, power_kw = $4, racks = $5, shelves_per_rack = $6, \
         devices_per_shelf = $7, shelf_dims_mm = $8, description = $9, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .bind(&f.name)
    .bind(&f.short_name)
    .bind(f.power_kw)
    .bind(f.racks)
    .bind(f.shelves_per_rack)
    .bind(f.devices_per_shelf)
    .bind(&f.shelf_dims_mm)
    .bind(&f.description)
    .execute(&mut *tx)
    .await
    .map_err(AppError::unique_as(DUPLICATE))?;
    audit::record(&mut *tx, "container", id, "update", audit::diff(&before, &f)).await?;
    tx.commit().await?;
    Ok(Json(fetch(&db, id).await?))
}

/// Устройства, которые перестали бы помещаться при новых параметрах шаблона.
async fn check_occupancy(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    container_id: Uuid,
    f: &ContainerFields,
) -> AppResult<()> {
    let outside = sqlx::query_scalar::<_, String>(
        "SELECT d.device_index FROM device_placements p \
         JOIN module_containers mc ON mc.id = p.module_container_id JOIN devices d ON d.id = p.device_id \
         WHERE mc.container_id = $1 AND (p.rack > $2 OR p.shelf > $3) ORDER BY d.device_index",
    )
    .bind(container_id)
    .bind(f.racks)
    .bind(f.shelves_per_rack)
    .fetch_all(&mut **tx)
    .await?;
    if !outside.is_empty() {
        return Err(conflict(
            "Новое число стеллажей или полок меньше занятого",
            &outside,
        ));
    }

    let crowded = sqlx::query_scalar::<_, String>(
        "SELECT d.device_index FROM device_placements p \
         JOIN module_containers mc ON mc.id = p.module_container_id JOIN devices d ON d.id = p.device_id \
         WHERE mc.container_id = $1 AND (p.module_container_id, p.rack, p.shelf) IN ( \
           SELECT p2.module_container_id, p2.rack, p2.shelf FROM device_placements p2 \
           JOIN module_containers mc2 ON mc2.id = p2.module_container_id WHERE mc2.container_id = $1 \
           GROUP BY 1, 2, 3 HAVING count(*) > $2) ORDER BY d.device_index",
    )
    .bind(container_id)
    .bind(f.devices_per_shelf)
    .fetch_all(&mut **tx)
    .await?;
    if !crowded.is_empty() {
        return Err(conflict(
            &format!("На некоторых полках больше {} устройств", f.devices_per_shelf),
            &crowded,
        ));
    }

    let max_load_w = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(max(load), 0)::bigint FROM ( \
           SELECT sum(COALESCE(m.power_w, 0)) AS load FROM device_placements p \
           JOIN module_containers mc ON mc.id = p.module_container_id JOIN devices d ON d.id = p.device_id \
           JOIN device_models m ON m.id = d.model_id WHERE mc.container_id = $1 GROUP BY p.module_container_id) t",
    )
    .bind(container_id)
    .fetch_one(&mut **tx)
    .await?;
    if max_load_w as f64 > f.power_kw * 1000.0 {
        return Err(AppError::Conflict(format!(
            "Мощность {} кВт меньше текущей нагрузки одного из экземпляров ({:.2} кВт). Сначала переместите устройства.",
            f.power_kw,
            max_load_w as f64 / 1000.0
        )));
    }
    Ok(())
}

fn conflict(reason: &str, indexes: &[String]) -> AppError {
    let shown: Vec<&str> = indexes.iter().take(10).map(String::as_str).collect();
    let more = indexes.len().saturating_sub(shown.len());
    let tail = if more > 0 { format!(" и ещё {more}") } else { String::new() };
    AppError::Conflict(format!(
        "{reason}. Затронуто устройств: {} (Index: {}{tail}). Сначала переместите их.",
        indexes.len(),
        shown.join(", ")
    ))
}
