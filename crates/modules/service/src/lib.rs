//! Обслуживание устройств по образцу mf-old: статусы с матрицей переходов, отправки контрагентам
//! (статус устройства следует за датами отправки) и склад комплектующих.

mod parts;
mod shipments;
mod statuses;

use axum::Router;
use skladno_core::{
    AppError, AppResult, Db,
    search::{Criterion, DeviceSearch},
};
use uuid::Uuid;

pub fn router() -> Router<Db> {
    Router::new()
        .merge(statuses::router())
        .merge(shipments::router())
        .merge(parts::router())
}

#[derive(Debug, sqlx::FromRow)]
struct DeviceRef {
    id: Uuid,
    device_index: String,
}

/// Устройства по строке из номеров, диапазонов и MAC («1-5, 9000001»). Текст не принимается:
/// по модели или клиенту легко зацепить лишние устройства.
async fn resolve_devices<'e, E: sqlx::PgExecutor<'e>>(
    executor: E,
    text: &str,
) -> AppResult<Vec<DeviceRef>> {
    let search = DeviceSearch::parse(text);
    if search.is_empty() {
        return Err(AppError::Validation(
            "Укажите INDEX устройств: «0000001-0000004, 0000007»".into(),
        ));
    }
    let mut indexes = Vec::new();
    let mut ranges_from = Vec::new();
    let mut ranges_to = Vec::new();
    let mut macs = Vec::new();
    for criterion in &search.criteria {
        match criterion {
            Criterion::Index(i) => indexes.push(i.clone()),
            Criterion::Range(a, b) => {
                ranges_from.push(a.clone());
                ranges_to.push(b.clone());
            }
            Criterion::Mac(m) => macs.push(m.clone()),
            Criterion::Text(t) => {
                return Err(AppError::Validation(format!(
                    "«{t}» — не INDEX и не MAC. Укажите номера устройств, диапазоны или MAC"
                )));
            }
        }
    }
    let devices = sqlx::query_as::<_, DeviceRef>(
        "SELECT v.id, v.device_index FROM devices v \
         WHERE v.device_index = ANY($1) OR v.mac_address = ANY($4) \
            OR EXISTS (SELECT 1 FROM UNNEST($2::text[], $3::text[]) AS r(a, b) WHERE v.device_index BETWEEN r.a AND r.b) \
         ORDER BY v.device_index",
    )
    .bind(&indexes)
    .bind(&ranges_from)
    .bind(&ranges_to)
    .bind(&macs)
    .fetch_all(executor)
    .await?;
    let missing: Vec<&String> = indexes
        .iter()
        .filter(|i| !devices.iter().any(|d| &d.device_index == *i))
        .collect();
    if !missing.is_empty() {
        let list: Vec<&str> = missing.iter().map(|s| s.as_str()).collect();
        return Err(AppError::NotFound(format!(
            "Нет устройств с INDEX: {}",
            list.join(", ")
        )));
    }
    if devices.is_empty() {
        return Err(AppError::NotFound(
            "По этим номерам и MAC устройств нет".into(),
        ));
    }
    Ok(devices)
}
