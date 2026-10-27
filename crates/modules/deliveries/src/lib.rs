//! F-03. Поставки устройств: шапка + строки, присвоение Index, этапы до закрытия.

mod files;
mod index;
mod inventory;

pub use index::{device_uuid, format_index};

use std::collections::HashSet;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{
    AppError, AppResult, Db, audit,
    auth::{self, Role},
    text,
};
use uuid::Uuid;

/// Этапы поставки по порядку; переход только на следующий.
const STAGES: [&str; 4] = ["created", "receiving", "confirmation", "closed"];
const MAX_DEVICES_PER_DELIVERY: i32 = 10_000;
/// Сериализует создание поставок: номер ПУ-ГОД-НОМЕР и диапазоны Index выдаются без гонок.
const CREATE_LOCK: i64 = 7301;

const SUMMARY: &str = "SELECT d.id, d.number, d.client_id, c.name AS client_name, d.device_group, \
    d.delivery_date, d.basis_doc, d.basis_date, d.destination, d.stage, d.condition, \
    (d.condition IS NOT DISTINCT FROM 'factory_new') AS customs, d.created_at, \
    (SELECT count(*) FROM devices v WHERE v.delivery_id = d.id) AS devices \
    FROM deliveries d JOIN clients c ON c.id = d.client_id";

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Destination {
    Park,
    Workshop,
}

/// D-05: «Состояние» поставки. Таможенные — только «Прямо с завода»,
/// остальные три зависят от внешнего состояния устройств.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Condition {
    FactoryNew,
    SlightlyUsed,
    FieldTested,
    BattleHardened,
}

impl Condition {
    fn as_str(self) -> &'static str {
        match self {
            Condition::FactoryNew => "factory_new",
            Condition::SlightlyUsed => "slightly_used",
            Condition::FieldTested => "field_tested",
            Condition::BattleHardened => "battle_hardened",
        }
    }
}

impl Destination {
    fn as_str(self) -> &'static str {
        match self {
            Destination::Park => "park",
            Destination::Workshop => "workshop",
        }
    }
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DeliverySummary {
    id: Uuid,
    number: String,
    client_id: Uuid,
    client_name: String,
    device_group: Option<String>,
    delivery_date: NaiveDate,
    basis_doc: Option<String>,
    basis_date: Option<NaiveDate>,
    destination: String,
    stage: String,
    /// None — поставка перенесена из старой базы без этих данных.
    condition: Option<String>,
    customs: bool,
    created_at: DateTime<Utc>,
    devices: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct LineRow {
    model_id: Uuid,
    manufacturer: String,
    model: String,
    quantity: i32,
    first_index: Option<String>,
    last_index: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct DeviceRow {
    id: Uuid,
    device_index: String,
    manufacturer: String,
    model: String,
    /// Адрес полки MXCXSXP, если устройство уже размещено (F-09).
    location: Option<String>,
    mac_address: Option<String>,
    serial_no: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DeliveryDetail {
    #[serde(flatten)]
    summary: DeliverySummary,
    lines: Vec<LineRow>,
    devices: Vec<DeviceRow>,
}

#[derive(Debug, Deserialize)]
pub struct LineInput {
    model_id: Uuid,
    quantity: i32,
}

#[derive(Debug, Deserialize)]
pub struct CreateDelivery {
    /// Ключ идемпотентности: повтор того же запроса возвращает уже созданную поставку.
    request_id: Uuid,
    client_id: Uuid,
    device_group: Option<String>,
    delivery_date: NaiveDate,
    basis_doc: Option<String>,
    basis_date: Option<NaiveDate>,
    destination: Destination,
    condition: Condition,
    lines: Vec<LineInput>,
}

#[derive(Debug, Deserialize)]
pub struct AdvanceInput {
    expected_stage: String,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    q: Option<String>,
    stage: Option<String>,
}

pub fn router() -> Router<Db> {
    Router::new()
        .route("/deliveries", get(list).post(create))
        .route("/deliveries/groups", get(groups))
        .route("/deliveries/index-ranges", get(index_ranges))
        .route("/deliveries/{id}", get(detail))
        .route("/deliveries/{id}/advance", post(advance))
        .route("/deliveries/{id}/warnings", get(warnings))
        .merge(files::router())
        .merge(inventory::router())
}

async fn list(
    State(db): State<Db>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Vec<DeliverySummary>>> {
    let stage = text::clean(query.stage);
    let rows = sqlx::query_as::<_, DeliverySummary>(&format!(
        "{SUMMARY} WHERE ($1::text IS NULL OR d.number ILIKE $1 OR c.name ILIKE $1 OR d.device_group ILIKE $1 OR d.basis_doc ILIKE $1) \
         AND ($2::text IS NULL OR d.stage = $2) ORDER BY d.year DESC, d.seq DESC"
    ))
    .bind(text::like_pattern(query.q.as_deref()))
    .bind(stage)
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

/// «Группа устройств» создаётся на месте: подсказки берутся из уже введённых значений.
async fn groups(State(db): State<Db>) -> AppResult<Json<Vec<String>>> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT device_group FROM deliveries WHERE device_group IS NOT NULL ORDER BY device_group",
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

#[derive(Serialize, sqlx::FromRow)]
struct IndexRange {
    destination: String,
    next_value: i32,
    max_value: i32,
}

async fn index_ranges(State(db): State<Db>) -> AppResult<Json<Vec<IndexRange>>> {
    let rows = sqlx::query_as::<_, IndexRange>(
        "SELECT destination, next_value, max_value FROM index_ranges ORDER BY next_value",
    )
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

async fn detail(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<DeliveryDetail>> {
    Ok(Json(load(&db, id).await?))
}

async fn load(db: &Db, id: Uuid) -> AppResult<DeliveryDetail> {
    let summary = sqlx::query_as::<_, DeliverySummary>(&format!("{SUMMARY} WHERE d.id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Поставка не найдена".into()))?;
    let lines = sqlx::query_as::<_, LineRow>(
        "SELECT l.model_id, m.manufacturer, m.model, l.quantity, \
         min(v.device_index) AS first_index, max(v.device_index) AS last_index \
         FROM delivery_lines l JOIN device_models m ON m.id = l.model_id \
         LEFT JOIN devices v ON v.delivery_id = l.delivery_id AND v.model_id = l.model_id \
         WHERE l.delivery_id = $1 GROUP BY l.id, m.id ORDER BY l.position",
    )
    .bind(id)
    .fetch_all(db)
    .await?;
    let devices = sqlx::query_as::<_, DeviceRow>(
        "SELECT v.id, v.device_index, m.manufacturer, m.model, v.mac_address, v.serial_no, \
         skladno_address(md.number, mc.number, p.rack, p.shelf) AS location \
         FROM devices v JOIN device_models m ON m.id = v.model_id \
         LEFT JOIN device_placements p ON p.device_id = v.id \
         LEFT JOIN module_containers mc ON mc.id = p.module_container_id \
         LEFT JOIN modules md ON md.id = mc.module_id \
         WHERE v.delivery_id = $1 ORDER BY v.device_index",
    )
    .bind(id)
    .fetch_all(db)
    .await?;
    Ok(DeliveryDetail {
        summary,
        lines,
        devices,
    })
}

fn validate_lines(lines: &[LineInput]) -> AppResult<i32> {
    if lines.is_empty() {
        return Err(AppError::Validation(
            "Добавьте хотя бы одну строку с моделью".into(),
        ));
    }
    let mut seen = HashSet::new();
    let mut total: i32 = 0;
    for line in lines {
        if !(1..=MAX_DEVICES_PER_DELIVERY).contains(&line.quantity) {
            return Err(AppError::Validation(format!(
                "Количество в строке — от 1 до {MAX_DEVICES_PER_DELIVERY}"
            )));
        }
        if !seen.insert(line.model_id) {
            return Err(AppError::Validation(
                "Одна модель указана в нескольких строках — объедините их".into(),
            ));
        }
        total += line.quantity;
    }
    if total > MAX_DEVICES_PER_DELIVERY {
        return Err(AppError::Validation(format!(
            "В одной поставке не больше {MAX_DEVICES_PER_DELIVERY} устройств"
        )));
    }
    Ok(total)
}

async fn create(
    State(db): State<Db>,
    Json(input): Json<CreateDelivery>,
) -> AppResult<(StatusCode, Json<DeliveryDetail>)> {
    let total = validate_lines(&input.lines)?;
    let device_group = text::clean(input.device_group);
    let basis_doc = text::clean(input.basis_doc);
    let destination = input.destination.as_str();

    let mut tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(CREATE_LOCK)
        .execute(&mut *tx)
        .await?;

    let existing = sqlx::query_scalar::<_, Uuid>("SELECT id FROM deliveries WHERE request_id = $1")
        .bind(input.request_id)
        .fetch_optional(&mut *tx)
        .await?;
    if let Some(id) = existing {
        tx.commit().await?;
        return Ok((StatusCode::OK, Json(load(&db, id).await?)));
    }

    let client_exists =
        sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM clients WHERE id = $1)")
            .bind(input.client_id)
            .fetch_one(&mut *tx)
            .await?;
    if !client_exists {
        return Err(AppError::Validation(
            "Выберите клиента из справочника".into(),
        ));
    }

    let model_ids: Vec<Uuid> = input.lines.iter().map(|l| l.model_id).collect();
    let active_models = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM device_models WHERE id = ANY($1) AND NOT archived",
    )
    .bind(&model_ids)
    .fetch_one(&mut *tx)
    .await?;
    if active_models != model_ids.len() as i64 {
        return Err(AppError::Validation(
            "В строках есть модель, которой нет в реестре или она в архиве".into(),
        ));
    }

    let (next_value, max_value) = sqlx::query_as::<_, (i32, i32)>(
        "SELECT next_value, max_value FROM index_ranges WHERE destination = $1 FOR UPDATE",
    )
    .bind(destination)
    .fetch_one(&mut *tx)
    .await?;
    let indexes = index::allocate(next_value, max_value, total).ok_or_else(|| {
        AppError::Conflict(format!(
            "Диапазон Index для этого назначения исчерпан (свободно {}), обратитесь к администратору",
            (max_value - next_value + 1).max(0)
        ))
    })?;

    let year = input.delivery_date.year();
    let seq = sqlx::query_scalar::<_, i32>(
        "SELECT COALESCE(max(seq), 0) + 1 FROM deliveries WHERE year = $1",
    )
    .bind(year)
    .fetch_one(&mut *tx)
    .await?;
    let number = format!("ПУ-{year}-{seq:04}");

    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO deliveries (request_id, number, year, seq, client_id, device_group, delivery_date, \
         basis_doc, basis_date, destination, condition) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id",
    )
    .bind(input.request_id)
    .bind(&number)
    .bind(year)
    .bind(seq)
    .bind(input.client_id)
    .bind(&device_group)
    .bind(input.delivery_date)
    .bind(&basis_doc)
    .bind(input.basis_date)
    .bind(destination)
    .bind(input.condition.as_str())
    .fetch_one(&mut *tx)
    .await?;

    let positions: Vec<i32> = (1..=input.lines.len() as i32).collect();
    let quantities: Vec<i32> = input.lines.iter().map(|l| l.quantity).collect();
    sqlx::query(
        "INSERT INTO delivery_lines (delivery_id, position, model_id, quantity) \
         SELECT $1, u.position, u.model_id, u.quantity FROM UNNEST($2::int[], $3::uuid[], $4::int[]) AS u(position, model_id, quantity)",
    )
    .bind(id)
    .bind(&positions)
    .bind(&model_ids)
    .bind(&quantities)
    .execute(&mut *tx)
    .await?;

    // Index выдаются подряд в порядке строк поставки.
    let device_models: Vec<Uuid> = input
        .lines
        .iter()
        .flat_map(|l| std::iter::repeat_n(l.model_id, l.quantity as usize))
        .collect();
    let device_ids: Vec<Uuid> = indexes.iter().map(|i| index::device_uuid(i)).collect();
    sqlx::query(
        "INSERT INTO devices (id, device_index, delivery_id, model_id, destination) \
         SELECT u.id, u.device_index, $4, u.model_id, $5 FROM UNNEST($1::uuid[], $2::text[], $3::uuid[]) AS u(id, device_index, model_id)",
    )
    .bind(&device_ids)
    .bind(&indexes)
    .bind(&device_models)
    .bind(id)
    .bind(destination)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE index_ranges SET next_value = $2 WHERE destination = $1")
        .bind(destination)
        .bind(next_value + total)
        .execute(&mut *tx)
        .await?;

    audit::record(
        &mut *tx,
        "delivery",
        id,
        "create",
        json!({
            "number": number,
            "client_id": input.client_id,
            "destination": destination,
            "devices": total,
            "index_from": indexes.first(),
            "index_to": indexes.last(),
        }),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(load(&db, id).await?)))
}

async fn advance(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<AdvanceInput>,
) -> AppResult<Json<DeliveryDetail>> {
    let mut tx = db.begin().await?;
    let stage =
        sqlx::query_scalar::<_, String>("SELECT stage FROM deliveries WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::NotFound("Поставка не найдена".into()))?;
    if stage != input.expected_stage {
        return Err(AppError::Conflict(
            "Этап поставки уже изменён другим пользователем — обновите страницу".into(),
        ));
    }
    let position = STAGES
        .iter()
        .position(|s| *s == stage)
        .unwrap_or(STAGES.len() - 1);
    let Some(next) = STAGES.get(position + 1) else {
        return Err(AppError::Conflict("Поставка уже закрыта".into()));
    };
    // Шаг 4 SPEC: подтверждение и закрытие поставки — Старший СА.
    if *next != "receiving" {
        auth::require(Role::Senior, "Подтверждение и закрытие поставки")?;
    }
    sqlx::query("UPDATE deliveries SET stage = $2, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(next)
        .execute(&mut *tx)
        .await?;
    // Предупреждения не блокируют этап, но фиксируются в журнале: кто и с чем подтвердил.
    let mut changes = json!({ "stage": { "old": stage, "new": next } });
    if *next != "receiving" {
        let warnings = stage_warnings(&mut *tx, id).await?;
        if !warnings.is_empty() {
            changes["warnings"] = json!(warnings);
        }
    }
    audit::record(&mut *tx, "delivery", id, "advance", changes).await?;
    tx.commit().await?;
    Ok(Json(load(&db, id).await?))
}

#[derive(sqlx::FromRow)]
struct WarningFacts {
    devices: i64,
    unplaced: i64,
    basis_doc: Option<String>,
    files: i64,
    condition: Option<String>,
}

/// Некритические замечания к поставке перед подтверждением и закрытием (SPEC: закрытие
/// с ними разрешено, пользователь видит их и подтверждает).
async fn stage_warnings<'e, E: sqlx::PgExecutor<'e>>(
    executor: E,
    id: Uuid,
) -> AppResult<Vec<String>> {
    let f = sqlx::query_as::<_, WarningFacts>(
        "SELECT (SELECT count(*) FROM devices v WHERE v.delivery_id = d.id) AS devices, \
         (SELECT count(*) FROM devices v WHERE v.delivery_id = d.id \
            AND NOT EXISTS (SELECT 1 FROM device_placements p WHERE p.device_id = v.id)) AS unplaced, \
         d.basis_doc, (SELECT count(*) FROM delivery_files f WHERE f.delivery_id = d.id) AS files, d.condition \
         FROM deliveries d WHERE d.id = $1",
    )
    .bind(id)
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| AppError::NotFound("Поставка не найдена".into()))?;
    let mut warnings = Vec::new();
    if f.unplaced > 0 {
        warnings.push(format!(
            "Не размещено устройств: {} из {}",
            f.unplaced, f.devices
        ));
    }
    if f.basis_doc.is_none() && f.files == 0 {
        warnings.push("Нет документа-основания: не указан номер и не прикреплены файлы".into());
    }
    if f.condition.is_none() {
        warnings.push("Не указано состояние поставки".into());
    }
    Ok(warnings)
}

#[derive(Serialize)]
struct Warnings {
    warnings: Vec<String>,
}

async fn warnings(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<Warnings>> {
    Ok(Json(Warnings {
        warnings: stage_warnings(&db, id).await?,
    }))
}
