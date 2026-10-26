//! Импорт и экспорт (сквозная тема SPEC): выгрузка реестров в CSV, XLSX и MD со статистикой,
//! загрузка справочников из CSV и XLSX.

mod import;
mod registries;
mod table;

use axum::{
    Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::header,
    response::IntoResponse,
    routing::{get, post},
};
use chrono::Local;
use serde::Deserialize;
use skladno_core::{AppError, AppResult, Db};

use table::ExportFormat;

pub fn router() -> Router<Db> {
    Router::new()
        .route("/export/{name}", get(export))
        // Файл импорта приходит телом запроса; до 20 МБ (около 10 000 строк XLSX).
        .route(
            "/import/{name}",
            post(import::import).layer(DefaultBodyLimit::max(20 * 1024 * 1024)),
        )
}

#[derive(Deserialize)]
struct ExportQuery {
    #[serde(default = "default_format")]
    format: String,
}

fn default_format() -> String {
    "xlsx".into()
}

async fn export(
    State(db): State<Db>,
    Path(name): Path<String>,
    Query(query): Query<ExportQuery>,
) -> AppResult<impl IntoResponse> {
    let format = ExportFormat::parse(&query.format)
        .ok_or_else(|| AppError::Validation("Формат выгрузки: csv, xlsx или md".into()))?;
    let table = registries::build(&db, &name).await?.ok_or_else(|| {
        AppError::NotFound(format!("Нет реестра «{name}». Доступны: {}", registries::NAMES.join(", ")))
    })?;
    let now = Local::now();
    let generated = now.format("%d.%m.%Y %H:%M").to_string();
    let body = match format {
        ExportFormat::Csv => table::to_csv(&table),
        ExportFormat::Md => table::to_md(&table, &generated),
        ExportFormat::Xlsx => table::to_xlsx(&table, &generated)
            .map_err(|e| AppError::Validation(format!("Не удалось собрать XLSX: {e}")))?,
    };
    let filename = format!("skladno-{}-{}.{}", table.file, now.format("%Y-%m-%d"), format.extension());
    Ok((
        [
            (header::CONTENT_TYPE, format.content_type().to_string()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"")),
        ],
        body,
    ))
}
