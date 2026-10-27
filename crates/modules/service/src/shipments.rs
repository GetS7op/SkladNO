//! Отправки устройств контрагенту (ремонт, возврат клиенту) и их возвращение, как в mf-old.
//! Статус устройства следует за самой поздней датой: упаковали — «Упакован», отправили — «Возврат»,
//! вернулось — «Ремонт». Пока нет даты прибытия, отправка открыта и упаковать устройство повторно нельзя.

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
    text,
};
use uuid::Uuid;

use crate::resolve_devices;

pub fn router() -> Router<Db> {
    Router::new()
        .route("/shipments", get(list).post(create))
        .route("/shipments/stats", get(stats))
        .route("/shipments/recipients", get(recipients))
        .route("/shipments/{id}", put(update))
}

/// Статус, который получает устройство на шаге отправки (решение заказчика в mf-old).
const PACKED: &str = "Упакован";
const SHIPPED: &str = "Возврат";
const ARRIVED: &str = "Ремонт";

fn stage_status(
    packed: Option<NaiveDate>,
    shipped: Option<NaiveDate>,
    arrived: Option<NaiveDate>,
) -> Option<&'static str> {
    if arrived.is_some() {
        Some(ARRIVED)
    } else if shipped.is_some() {
        Some(SHIPPED)
    } else if packed.is_some() {
        Some(PACKED)
    } else {
        None
    }
}

const SELECT: &str = "SELECT s.id, s.device_id, v.device_index, m.manufacturer, m.model, c.name AS client_name, \
    s.recipient, s.packed_at, s.shipped_at, s.arrived_at, s.comment, s.repair_note, \
    st.name AS status_name, s.created_at, s.created_by \
    FROM shipments s JOIN devices v ON v.id = s.device_id JOIN device_models m ON m.id = v.model_id \
    JOIN deliveries d ON d.id = v.delivery_id JOIN clients c ON c.id = d.client_id \
    LEFT JOIN device_statuses st ON st.id = v.status_id";

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Shipment {
    id: Uuid,
    device_id: Uuid,
    device_index: String,
    manufacturer: String,
    model: String,
    client_name: String,
    recipient: Option<String>,
    packed_at: Option<NaiveDate>,
    shipped_at: Option<NaiveDate>,
    arrived_at: Option<NaiveDate>,
    comment: Option<String>,
    repair_note: Option<String>,
    status_name: Option<String>,
    created_at: DateTime<Utc>,
    created_by: String,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    q: Option<String>,
    /// Только не вернувшиеся (нет даты прибытия).
    #[serde(default)]
    open: bool,
    device_id: Option<Uuid>,
}

async fn list(
    State(db): State<Db>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Vec<Shipment>>> {
    let rows = sqlx::query_as::<_, Shipment>(&format!(
        "{SELECT} WHERE ($1::text IS NULL OR v.device_index ILIKE $1 OR v.mac_address ILIKE $1 OR v.serial_no ILIKE $1 \
           OR s.recipient ILIKE $1 OR s.comment ILIKE $1 OR s.repair_note ILIKE $1 OR c.name ILIKE $1) \
         AND (NOT $2 OR s.arrived_at IS NULL) AND ($3::uuid IS NULL OR s.device_id = $3) \
         ORDER BY COALESCE(s.shipped_at, s.packed_at, s.arrived_at) DESC, v.device_index"
    ))
    .bind(text::like_pattern(query.q.as_deref()))
    .bind(query.open)
    .bind(query.device_id)
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Stats {
    total: i64,
    open: i64,
}

async fn stats(State(db): State<Db>) -> AppResult<Json<Stats>> {
    Ok(Json(
        sqlx::query_as::<_, Stats>("SELECT count(*) AS total, count(*) FILTER (WHERE arrived_at IS NULL) AS open FROM shipments")
            .fetch_one(&db)
            .await?,
    ))
}

/// Кому уже отправляли — подсказки для поля «Кому».
async fn recipients(State(db): State<Db>) -> AppResult<Json<Vec<String>>> {
    Ok(Json(
        sqlx::query_scalar::<_, String>(
            "SELECT recipient FROM shipments WHERE recipient IS NOT NULL GROUP BY recipient ORDER BY count(*) DESC, recipient LIMIT 50",
        )
        .fetch_all(&db)
        .await?,
    ))
}

#[derive(Debug, Deserialize)]
pub struct ShipmentFields {
    recipient: Option<String>,
    packed_at: Option<NaiveDate>,
    shipped_at: Option<NaiveDate>,
    arrived_at: Option<NaiveDate>,
    comment: Option<String>,
    repair_note: Option<String>,
}

impl ShipmentFields {
    fn validate(self) -> AppResult<Self> {
        if self.packed_at.is_none() && self.shipped_at.is_none() && self.arrived_at.is_none() {
            return Err(AppError::Validation(
                "Укажите хотя бы одну дату: упаковки, отправки или прибытия".into(),
            ));
        }
        let order = [self.packed_at, self.shipped_at, self.arrived_at];
        let dates: Vec<NaiveDate> = order.iter().flatten().copied().collect();
        if dates.windows(2).any(|w| w[0] > w[1]) {
            return Err(AppError::Validation(
                "Даты идут по порядку: упаковка ≤ отправка ≤ прибытие".into(),
            ));
        }
        Ok(Self {
            recipient: text::clean(self.recipient),
            comment: text::clean(self.comment),
            repair_note: text::clean(self.repair_note),
            ..self
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateInput {
    /// INDEX, диапазоны или MAC: «0000001-0000004, 0000007».
    devices: String,
    #[serde(flatten)]
    fields: ShipmentFields,
}

#[derive(Debug, Serialize)]
pub struct Blocked {
    device_index: String,
    reason: String,
}

#[derive(Debug, Serialize)]
pub struct CreateReport {
    created: Vec<String>,
    blocked: Vec<Blocked>,
    /// Статус отправки, которого нет в справочнике: устройство осталось без смены статуса.
    missing_status: Option<String>,
}

/// Ставит устройству статус шага отправки. Возвращает имя статуса, если его нет в справочнике.
async fn apply_status(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    device_id: Uuid,
    device_index: &str,
    fields: &ShipmentFields,
) -> AppResult<Option<String>> {
    let Some(name) = stage_status(fields.packed_at, fields.shipped_at, fields.arrived_at) else {
        return Ok(None);
    };
    let Some(status_id) = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM device_statuses WHERE lower(name) = lower($1)",
    )
    .bind(name)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(Some(name.to_string()));
    };
    let old = sqlx::query_scalar::<_, Option<String>>(
        "SELECT st.name FROM devices v LEFT JOIN device_statuses st ON st.id = v.status_id WHERE v.id = $1",
    )
    .bind(device_id)
    .fetch_one(&mut **tx)
    .await?;
    if old.as_deref() != Some(name) {
        sqlx::query("UPDATE devices SET status_id = $2 WHERE id = $1")
            .bind(device_id)
            .bind(status_id)
            .execute(&mut **tx)
            .await?;
        audit::record(
            &mut **tx,
            "device",
            device_id,
            "status",
            json!({ "device_index": device_index, "status": { "old": old, "new": name }, "source": "отправка" }),
        )
        .await?;
    }
    Ok(None)
}

async fn create(
    State(db): State<Db>,
    Json(input): Json<CreateInput>,
) -> AppResult<(StatusCode, Json<CreateReport>)> {
    let user = auth::require(Role::Operator, "Отправка устройств")?;
    let fields = input.fields.validate()?;
    let mut tx = db.begin().await?;
    let devices = resolve_devices(&mut *tx, &input.devices).await?;
    let mut report = CreateReport {
        created: Vec::new(),
        blocked: Vec::new(),
        missing_status: None,
    };
    for device in devices {
        // Блокировка устройства: две одновременные отправки одного номера не пройдут.
        sqlx::query("SELECT 1 FROM devices WHERE id = $1 FOR UPDATE")
            .bind(device.id)
            .execute(&mut *tx)
            .await?;
        let open = sqlx::query_as::<_, (Option<NaiveDate>, Option<NaiveDate>)>(
            "SELECT packed_at, shipped_at FROM shipments WHERE device_id = $1 AND arrived_at IS NULL",
        )
        .bind(device.id)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some((packed, shipped)) = open {
            let reason = match shipped.or(packed) {
                Some(date) if shipped.is_some() => {
                    format!(
                        "отправлено {} и ещё не вернулось — проставьте дату прибытия",
                        date.format("%d.%m.%Y")
                    )
                }
                Some(date) => format!("упаковано {} и ещё не отправлено", date.format("%d.%m.%Y")),
                None => "есть незакрытая отправка".into(),
            };
            report.blocked.push(Blocked {
                device_index: device.device_index,
                reason,
            });
            continue;
        }
        let id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO shipments (device_id, recipient, packed_at, shipped_at, arrived_at, comment, repair_note, created_by) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        )
        .bind(device.id)
        .bind(&fields.recipient)
        .bind(fields.packed_at)
        .bind(fields.shipped_at)
        .bind(fields.arrived_at)
        .bind(&fields.comment)
        .bind(&fields.repair_note)
        .bind(&user.login)
        .fetch_one(&mut *tx)
        .await?;
        audit::record(
            &mut *tx,
            "device",
            device.id,
            "shipment",
            json!({
                "device_index": device.device_index, "shipment": id, "recipient": fields.recipient,
                "packed_at": fields.packed_at, "shipped_at": fields.shipped_at, "arrived_at": fields.arrived_at,
                "comment": fields.comment,
            }),
        )
        .await?;
        if let Some(missing) =
            apply_status(&mut tx, device.id, &device.device_index, &fields).await?
        {
            report.missing_status = Some(missing);
        }
        report.created.push(device.device_index);
    }
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(report)))
}

#[derive(Debug, Serialize)]
pub struct UpdateReport {
    shipment: Shipment,
    missing_status: Option<String>,
}

async fn update(
    State(db): State<Db>,
    Path(id): Path<Uuid>,
    Json(fields): Json<ShipmentFields>,
) -> AppResult<Json<UpdateReport>> {
    auth::require(Role::Operator, "Правка отправки")?;
    let fields = fields.validate()?;
    let mut tx = db.begin().await?;
    let (device_id, device_index, before) = sqlx::query_as::<_, (Uuid, String, serde_json::Value)>(
        "SELECT s.device_id, v.device_index, json_build_object('recipient', s.recipient, 'packed_at', s.packed_at, \
           'shipped_at', s.shipped_at, 'arrived_at', s.arrived_at, 'comment', s.comment, 'repair_note', s.repair_note) \
         FROM shipments s JOIN devices v ON v.id = s.device_id WHERE s.id = $1 FOR UPDATE OF s",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Отправка не найдена".into()))?;
    sqlx::query(
        "UPDATE shipments SET recipient = $2, packed_at = $3, shipped_at = $4, arrived_at = $5, comment = $6, \
         repair_note = $7, updated_at = now() WHERE id = $1",
    )
    .bind(id)
    .bind(&fields.recipient)
    .bind(fields.packed_at)
    .bind(fields.shipped_at)
    .bind(fields.arrived_at)
    .bind(&fields.comment)
    .bind(&fields.repair_note)
    .execute(&mut *tx)
    .await
    .map_err(AppError::unique_as("У устройства уже есть другая незакрытая отправка"))?;
    let after = json!({
        "recipient": fields.recipient, "packed_at": fields.packed_at, "shipped_at": fields.shipped_at,
        "arrived_at": fields.arrived_at, "comment": fields.comment, "repair_note": fields.repair_note,
    });
    let mut changes = audit::diff(&before, &after);
    if let Some(map) = changes.as_object_mut() {
        map.insert("device_index".into(), json!(device_index));
    }
    audit::record(&mut *tx, "device", device_id, "shipment_update", changes).await?;
    let missing_status = apply_status(&mut tx, device_id, &device_index, &fields).await?;
    tx.commit().await?;
    let shipment = sqlx::query_as::<_, Shipment>(&format!("{SELECT} WHERE s.id = $1"))
        .bind(id)
        .fetch_one(&db)
        .await?;
    Ok(Json(UpdateReport {
        shipment,
        missing_status,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_follows_latest_date() {
        let d = NaiveDate::from_ymd_opt(2026, 10, 1);
        assert_eq!(stage_status(d, None, None), Some(PACKED));
        assert_eq!(stage_status(d, d, None), Some(SHIPPED));
        assert_eq!(stage_status(d, d, d), Some(ARRIVED));
        assert_eq!(stage_status(None, None, None), None);
    }

    #[test]
    fn dates_in_order() {
        let fields = |p, s, a| ShipmentFields {
            recipient: None,
            packed_at: NaiveDate::from_ymd_opt(2026, 10, p),
            shipped_at: NaiveDate::from_ymd_opt(2026, 10, s),
            arrived_at: NaiveDate::from_ymd_opt(2026, 10, a),
            comment: None,
            repair_note: None,
        };
        assert!(fields(1, 2, 3).validate().is_ok());
        assert!(fields(3, 2, 4).validate().is_err());
    }
}
