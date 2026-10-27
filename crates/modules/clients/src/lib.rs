//! F-02. Клиенты: справочник без удаления и архива, сводка по поставкам и устройствам.

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::IntoResponse,
    routing::{get, put},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{AppError, AppResult, Db, audit, text};
use uuid::Uuid;

// Счётчики включают все поставки клиента независимо от этапа.
const SELECT: &str = "SELECT c.id, c.name, c.note, \
    (SELECT count(*) FROM deliveries d WHERE d.client_id = c.id) AS deliveries, \
    (SELECT count(*) FROM devices v JOIN deliveries d ON d.id = v.delivery_id WHERE d.client_id = c.id) AS devices \
    FROM clients c";

/// Импорт одного клиента (по тем же правилам, что ручной ввод): true — создан, false — такой уже есть.
pub async fn import_one(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    input: ClientInput,
) -> AppResult<bool> {
    let fields = validate(input)?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO clients (name, note) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id",
    )
    .bind(&fields.name)
    .bind(&fields.note)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(id) = id else { return Ok(false) };
    audit::record(&mut **tx, "client", id, "import", json!(fields)).await?;
    Ok(true)
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Client {
    id: Uuid,
    name: String,
    note: Option<String>,
    deliveries: i64,
    devices: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
struct ClientFields {
    name: String,
    note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ClientInput {
    pub name: String,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    q: Option<String>,
}

pub fn router() -> Router<Db> {
    Router::new()
        .route("/clients", get(list).post(create))
        .route("/clients/{id}", put(update))
        .route("/clients/{id}/devices.csv", get(export_devices))
}

fn validate(input: ClientInput) -> AppResult<ClientFields> {
    let name = input.name.trim().to_string();
    if name.chars().count() < 3 {
        return Err(AppError::Validation(
            "Наименование клиента: не короче 3 символов".into(),
        ));
    }
    Ok(ClientFields {
        name,
        note: text::clean(input.note),
    })
}

fn duplicate(name: &str) -> String {
    format!("Клиент «{name}» уже есть в справочнике")
}

async fn list(
    State(db): State<Db>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Vec<Client>>> {
    let rows = sqlx::query_as::<_, Client>(&format!(
        "{SELECT} WHERE ($1::text IS NULL OR c.name ILIKE $1 OR c.note ILIKE $1) ORDER BY lower(c.name)"
    ))
    .bind(text::like_pattern(query.q.as_deref()))
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

async fn fetch(db: &Db, id: Uuid) -> AppResult<Client> {
    sqlx::query_as::<_, Client>(&format!("{SELECT} WHERE c.id = $1"))
        .bind(id)
        .fetch_optional(db)
        .await?
        .ok_or_else(|| AppError::NotFound("Клиент не найден".into()))
}

async fn create(
    State(db): State<Db>,
    Json(input): Json<ClientInput>,
) -> AppResult<(StatusCode, Json<Client>)> {
    let fields = validate(input)?;
    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO clients (name, note) VALUES ($1, $2) RETURNING id",
    )
    .bind(&fields.name)
    .bind(&fields.note)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::unique_as(duplicate(&fields.name)))?;
    audit::record(&mut *tx, "client", id, "create", json!(fields)).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(fetch(&db, id).await?)))
}

async fn update(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(input): Json<ClientInput>,
) -> AppResult<Json<Client>> {
    let fields = validate(input)?;
    let mut tx = db.begin().await?;
    let before = sqlx::query_as::<_, ClientFields>(
        "SELECT name, note FROM clients WHERE id = $1 FOR UPDATE",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Клиент не найден".into()))?;
    sqlx::query("UPDATE clients SET name = $2, note = $3, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(&fields.name)
        .bind(&fields.note)
        .execute(&mut *tx)
        .await
        .map_err(AppError::unique_as(duplicate(&fields.name)))?;
    audit::record(
        &mut *tx,
        "client",
        id,
        "update",
        audit::diff(&before, &fields),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(fetch(&db, id).await?))
}

#[derive(sqlx::FromRow)]
struct ExportRow {
    device_index: String,
    id: Uuid,
    manufacturer: String,
    model: String,
    number: String,
    delivery_date: chrono::NaiveDate,
    destination: String,
    stage: String,
}

/// Результат F-02: выгрузка устройств клиента в CSV (разделитель «;», BOM — для Excel).
async fn export_devices(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
) -> AppResult<impl IntoResponse> {
    let client = fetch(&db, id).await?;
    let rows = sqlx::query_as::<_, ExportRow>(
        "SELECT v.device_index, v.id, m.manufacturer, m.model, d.number, d.delivery_date, d.destination, d.stage \
         FROM devices v JOIN deliveries d ON d.id = v.delivery_id JOIN device_models m ON m.id = v.model_id \
         WHERE d.client_id = $1 ORDER BY v.device_index",
    )
    .bind(id)
    .fetch_all(&db)
    .await?;

    let mut csv = String::from(
        "\u{feff}Index;UUID;Производитель;Модель;Поставка;Дата поставки;Назначение;Этап\r\n",
    );
    for r in rows {
        let fields = [
            r.device_index,
            r.id.to_string(),
            r.manufacturer,
            r.model,
            r.number,
            r.delivery_date.format("%d.%m.%Y").to_string(),
            destination_label(&r.destination).into(),
            stage_label(&r.stage).into(),
        ];
        csv.push_str(&fields.map(|f| csv_field(&f)).join(";"));
        csv.push_str("\r\n");
    }
    let filename = format!("devices-{}.csv", client.id);
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        csv,
    ))
}

fn csv_field(value: &str) -> String {
    if value.contains([';', '"', '\n', '\r']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn destination_label(value: &str) -> &'static str {
    match value {
        "park" => "Парк",
        "workshop" => "Мастерская",
        _ => "?",
    }
}

fn stage_label(value: &str) -> &'static str {
    match value {
        "created" => "Создание",
        "receiving" => "Приём поставки",
        "confirmation" => "Подтверждение поставки",
        "closed" => "Закрытие поставки",
        _ => "?",
    }
}
