//! Настройки системы (таблица `settings`).

/// D-06: разделитель в адресе места; по умолчанию латинская «X».
pub const DEFAULT_SEPARATOR: &str = "X";

/// Допустимые разделители: не цифра и не пробел, чтобы адрес однозначно читался сканером.
pub const ALLOWED_SEPARATORS: [&str; 5] = ["X", "-", ".", "/", "_"];

pub async fn address_separator<'e, E: sqlx::PgExecutor<'e>>(
    executor: E,
) -> Result<String, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = 'address_separator'",
    )
    .fetch_optional(executor)
    .await?
    .unwrap_or_else(|| DEFAULT_SEPARATOR.to_string()))
}
