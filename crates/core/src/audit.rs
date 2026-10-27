//! Журнал действий: «когда, кто и что сделал», для изменений — старое и новое значение.

use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

/// Автор действий без пользователя (служебные операции).
pub const SYSTEM_ACTOR: &str = "system";

pub async fn record<'e, E>(
    executor: E,
    entity: &str,
    entity_id: Uuid,
    action: &str,
    changes: Value,
) -> Result<(), sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    sqlx::query(
        "INSERT INTO audit_log (actor, entity, entity_id, action, changes) VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(crate::auth::current().map_or_else(|| SYSTEM_ACTOR.to_string(), |u| u.login))
    .bind(entity)
    .bind(entity_id)
    .bind(action)
    .bind(changes)
    .execute(executor)
    .await?;
    Ok(())
}

/// Разница двух снимков записи: только изменившиеся поля в виде {поле: {old, new}}.
pub fn diff<T: Serialize>(before: &T, after: &T) -> Value {
    let (Ok(Value::Object(old)), Ok(Value::Object(new))) =
        (serde_json::to_value(before), serde_json::to_value(after))
    else {
        return Value::Null;
    };
    let changed = new
        .into_iter()
        .filter_map(|(key, new_value)| {
            let old_value = old.get(&key).cloned().unwrap_or(Value::Null);
            (old_value != new_value).then(|| {
                (
                    key,
                    serde_json::json!({ "old": old_value, "new": new_value }),
                )
            })
        })
        .collect();
    Value::Object(changed)
}
