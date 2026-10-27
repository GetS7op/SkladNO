//! Склад комплектующих, как в mf-old: типы и позиции, приход от поставщика, установка в устройство,
//! снятие с устройства (возвращается на склад) и списание. Остаток = приход − установлено + снято − списано;
//! установить или списать больше остатка нельзя.

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, put},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{
    AppError, AppResult, Db, audit,
    auth::{self, Role},
    search::{Criterion, DeviceSearch},
    text,
};
use uuid::Uuid;

pub fn router() -> Router<Db> {
    Router::new()
        .route("/parts", get(stock).post(create_part))
        .route("/parts/{id}", put(update_part))
        .route("/part-types", get(types).post(create_type))
        .route("/part-receipts", get(receipts).post(create_receipt))
        .route("/part-movements", get(movements).post(create_movement))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PartType {
    id: Uuid,
    name: String,
}

async fn types(State(db): State<Db>) -> AppResult<Json<Vec<PartType>>> {
    Ok(Json(
        sqlx::query_as::<_, PartType>("SELECT id, name FROM part_types ORDER BY name")
            .fetch_all(&db)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct TypeInput {
    name: String,
}

async fn create_type(
    State(db): State<Db>,
    Json(input): Json<TypeInput>,
) -> AppResult<(StatusCode, Json<PartType>)> {
    let name = text::clean(Some(input.name))
        .ok_or_else(|| AppError::Validation("Укажите название типа".into()))?;
    let row = sqlx::query_as::<_, PartType>(
        "INSERT INTO part_types (name) VALUES ($1) RETURNING id, name",
    )
    .bind(&name)
    .fetch_one(&db)
    .await
    .map_err(AppError::unique_as(format!("Тип «{name}» уже есть")))?;
    audit::record(&db, "part_type", row.id, "create", json!({ "name": name })).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

/// Остаток по позиции — из прихода и движений.
const STOCK: &str = "SELECT p.id, p.name, p.part_type_id, t.name AS type_name, p.note, \
    COALESCE((SELECT sum(l.quantity) FROM part_receipt_lines l WHERE l.part_id = p.id), 0)::bigint AS received, \
    COALESCE((SELECT sum(m.quantity) FROM part_movements m WHERE m.part_id = p.id AND m.action = 'installed'), 0)::bigint AS installed, \
    COALESCE((SELECT sum(m.quantity) FROM part_movements m WHERE m.part_id = p.id AND m.action = 'removed'), 0)::bigint AS removed, \
    COALESCE((SELECT sum(m.quantity) FROM part_movements m WHERE m.part_id = p.id AND m.action = 'written_off'), 0)::bigint AS written_off \
    FROM parts p LEFT JOIN part_types t ON t.id = p.part_type_id";

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PartStock {
    id: Uuid,
    name: String,
    part_type_id: Option<Uuid>,
    type_name: Option<String>,
    note: Option<String>,
    received: i64,
    installed: i64,
    removed: i64,
    written_off: i64,
}

#[derive(Debug, Serialize)]
pub struct PartRow {
    #[serde(flatten)]
    stock: PartStock,
    available: i64,
}

impl From<PartStock> for PartRow {
    fn from(stock: PartStock) -> Self {
        let available = stock.received - stock.installed + stock.removed - stock.written_off;
        Self { stock, available }
    }
}

async fn stock(State(db): State<Db>) -> AppResult<Json<Vec<PartRow>>> {
    let rows =
        sqlx::query_as::<_, PartStock>(&format!("{STOCK} ORDER BY t.name NULLS LAST, p.name"))
            .fetch_all(&db)
            .await?;
    Ok(Json(rows.into_iter().map(PartRow::from).collect()))
}

async fn fetch_part<'e, E: sqlx::PgExecutor<'e>>(executor: E, id: Uuid) -> AppResult<PartRow> {
    Ok(
        sqlx::query_as::<_, PartStock>(&format!("{STOCK} WHERE p.id = $1"))
            .bind(id)
            .fetch_optional(executor)
            .await?
            .ok_or_else(|| AppError::NotFound("Позиция не найдена".into()))?
            .into(),
    )
}

#[derive(Debug, Deserialize)]
pub struct PartInput {
    name: String,
    part_type_id: Option<Uuid>,
    note: Option<String>,
}

async fn create_part(
    State(db): State<Db>,
    Json(input): Json<PartInput>,
) -> AppResult<(StatusCode, Json<PartRow>)> {
    let name = text::clean(Some(input.name))
        .ok_or_else(|| AppError::Validation("Укажите название позиции".into()))?;
    let note = text::clean(input.note);
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO parts (name, part_type_id, note) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(&name)
    .bind(input.part_type_id)
    .bind(&note)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::unique_as(format!("Позиция «{name}» уже есть")))?;
    audit::record(
        &mut *tx,
        "part",
        id,
        "create",
        json!({ "name": name, "note": note }),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(fetch_part(&db, id).await?)))
}

async fn update_part(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<PartInput>,
) -> AppResult<Json<PartRow>> {
    let name = text::clean(Some(input.name))
        .ok_or_else(|| AppError::Validation("Укажите название позиции".into()))?;
    let note = text::clean(input.note);
    let mut tx = db.begin().await?;
    let before = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT name, note FROM parts WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Позиция не найдена".into()))?;
    sqlx::query("UPDATE parts SET name = $2, part_type_id = $3, note = $4, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(&name)
        .bind(input.part_type_id)
        .bind(&note)
        .execute(&mut *tx)
        .await
        .map_err(AppError::unique_as(format!("Позиция «{name}» уже есть")))?;
    audit::record(
        &mut *tx,
        "part",
        id,
        "update",
        audit::diff(
            &json!({ "name": before.0, "note": before.1 }),
            &json!({ "name": name, "note": note }),
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(fetch_part(&db, id).await?))
}

// ---------- Приход ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Receipt {
    id: Uuid,
    received_at: NaiveDate,
    supplier: Option<String>,
    document: Option<String>,
    note: Option<String>,
    created_by: String,
    /// «APW171215A × 10, FAN × 4».
    lines: String,
    quantity: i64,
}

async fn receipts(State(db): State<Db>) -> AppResult<Json<Vec<Receipt>>> {
    Ok(Json(
        sqlx::query_as::<_, Receipt>(
            "SELECT r.id, r.received_at, r.supplier, r.document, r.note, r.created_by, \
             string_agg(p.name || ' × ' || l.quantity, ', ' ORDER BY p.name) AS lines, sum(l.quantity)::bigint AS quantity \
             FROM part_receipts r JOIN part_receipt_lines l ON l.receipt_id = r.id JOIN parts p ON p.id = l.part_id \
             GROUP BY r.id ORDER BY r.received_at DESC, r.created_at DESC",
        )
        .fetch_all(&db)
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ReceiptLine {
    part_id: Uuid,
    quantity: i32,
}

#[derive(Debug, Deserialize)]
pub struct ReceiptInput {
    received_at: NaiveDate,
    supplier: Option<String>,
    document: Option<String>,
    note: Option<String>,
    lines: Vec<ReceiptLine>,
}

async fn create_receipt(
    State(db): State<Db>,
    Json(input): Json<ReceiptInput>,
) -> AppResult<StatusCode> {
    let user = auth::require(Role::Operator, "Приход комплектующих")?;
    if input.lines.is_empty() || input.lines.iter().any(|l| l.quantity <= 0) {
        return Err(AppError::Validation(
            "Добавьте позиции с количеством больше нуля".into(),
        ));
    }
    let mut parts: Vec<Uuid> = input.lines.iter().map(|l| l.part_id).collect();
    parts.sort();
    parts.dedup();
    if parts.len() != input.lines.len() {
        return Err(AppError::Validation(
            "Каждая позиция — в одной строке прихода".into(),
        ));
    }
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO part_receipts (received_at, supplier, document, note, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(input.received_at)
    .bind(text::clean(input.supplier))
    .bind(text::clean(input.document))
    .bind(text::clean(input.note))
    .bind(&user.login)
    .fetch_one(&mut *tx)
    .await?;
    let ids: Vec<Uuid> = input.lines.iter().map(|l| l.part_id).collect();
    let quantities: Vec<i32> = input.lines.iter().map(|l| l.quantity).collect();
    sqlx::query(
        "INSERT INTO part_receipt_lines (receipt_id, part_id, quantity) \
         SELECT $1, p, q FROM UNNEST($2::uuid[], $3::int[]) AS u (p, q)",
    )
    .bind(id)
    .bind(&ids)
    .bind(&quantities)
    .execute(&mut *tx)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(d) if d.is_foreign_key_violation() => {
            AppError::Validation("В приходе есть позиция, которой нет в справочнике".into())
        }
        _ => AppError::Db(e),
    })?;
    audit::record(
        &mut *tx,
        "part_receipt",
        id,
        "create",
        json!({ "received_at": input.received_at, "lines": input.lines.len(), "quantity": quantities.iter().sum::<i32>() }),
    )
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- Движение ----------

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Movement {
    id: Uuid,
    part_id: Uuid,
    part_name: String,
    action: String,
    quantity: i32,
    device_id: Option<Uuid>,
    device_index: Option<String>,
    note: Option<String>,
    at: DateTime<Utc>,
    actor: String,
}

#[derive(Debug, Deserialize)]
pub struct MovementQuery {
    part_id: Option<Uuid>,
    device_id: Option<Uuid>,
}

async fn movements(
    State(db): State<Db>,
    Query(query): Query<MovementQuery>,
) -> AppResult<Json<Vec<Movement>>> {
    Ok(Json(
        sqlx::query_as::<_, Movement>(
            "SELECT m.id, m.part_id, p.name AS part_name, m.action, m.quantity, m.device_id, v.device_index, m.note, m.at, m.actor \
             FROM part_movements m JOIN parts p ON p.id = m.part_id LEFT JOIN devices v ON v.id = m.device_id \
             WHERE ($1::uuid IS NULL OR m.part_id = $1) AND ($2::uuid IS NULL OR m.device_id = $2) \
             ORDER BY m.at DESC LIMIT 1000",
        )
        .bind(query.part_id)
        .bind(query.device_id)
        .fetch_all(&db)
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct MovementInput {
    part_id: Uuid,
    /// installed | removed | written_off
    action: String,
    quantity: i32,
    /// INDEX устройства (для установки и снятия).
    device_index: Option<String>,
    note: Option<String>,
}

fn action_label(action: &str) -> Option<&'static str> {
    match action {
        "installed" => Some("установлено"),
        "removed" => Some("снято"),
        "written_off" => Some("списано"),
        _ => None,
    }
}

async fn create_movement(
    State(db): State<Db>,
    Json(input): Json<MovementInput>,
) -> AppResult<(StatusCode, Json<PartRow>)> {
    let user = auth::require(Role::Operator, "Движение комплектующих")?;
    let label = action_label(&input.action)
        .ok_or_else(|| AppError::Validation("Неизвестное действие".into()))?;
    if input.quantity <= 0 {
        return Err(AppError::Validation("Количество — больше нуля".into()));
    }
    let mut tx = db.begin().await?;
    // Блокировка позиции: два одновременных списания не уведут остаток в минус.
    sqlx::query("SELECT 1 FROM parts WHERE id = $1 FOR UPDATE")
        .bind(input.part_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Позиция не найдена".into()))?;
    let part = fetch_part(&mut *tx, input.part_id).await?;

    let device = match text::clean(input.device_index) {
        Some(raw) => {
            let Some(Criterion::Index(index)) = DeviceSearch::parse(&raw).criteria.first().cloned()
            else {
                return Err(AppError::Validation("INDEX устройства — до 7 цифр".into()));
            };
            Some(
                sqlx::query_as::<_, (Uuid, String)>(
                    "SELECT id, device_index FROM devices WHERE device_index = $1",
                )
                .bind(&index)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| AppError::NotFound(format!("Устройства с INDEX {index} нет")))?,
            )
        }
        None => None,
    };
    if input.action != "written_off" && device.is_none() {
        return Err(AppError::Validation("Укажите INDEX устройства".into()));
    }
    if input.action != "removed" && part.available < i64::from(input.quantity) {
        return Err(AppError::Conflict(format!(
            "На складе «{}» — {} шт., а нужно {}",
            part.stock.name, part.available, input.quantity
        )));
    }
    let note = text::clean(input.note);
    sqlx::query(
        "INSERT INTO part_movements (part_id, action, quantity, device_id, note, actor) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(input.part_id)
    .bind(&input.action)
    .bind(input.quantity)
    .bind(device.as_ref().map(|d| d.0))
    .bind(&note)
    .bind(&user.login)
    .execute(&mut *tx)
    .await?;
    let changes = json!({
        "part": part.stock.name, "movement": label, "quantity": input.quantity,
        "device_index": device.as_ref().map(|d| d.1.clone()), "note": note,
    });
    match &device {
        // Установка и снятие видны в истории устройства.
        Some((device_id, _)) => {
            audit::record(&mut *tx, "device", *device_id, "part", changes).await?
        }
        None => audit::record(&mut *tx, "part", input.part_id, "written_off", changes).await?,
    }
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(fetch_part(&db, input.part_id).await?),
    ))
}
