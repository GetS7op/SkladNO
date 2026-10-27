//! Файлы документа-основания поставки (SPEC F-03: «Файлы (jpg, pdf на SMB)»).
//! Файлы пишутся в папку FILES_DIR по подпапкам поставок — её можно смонтировать с SMB-шары,
//! тогда документы видны и в сетевой папке. Удаления нет, как и у остальных записей учёта.

use std::path::PathBuf;

use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{StatusCode, header},
    response::IntoResponse,
    routing::get,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use skladno_core::{AppError, AppResult, Db, audit, auth};
use uuid::Uuid;

const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;

pub fn router() -> Router<Db> {
    Router::new()
        .route(
            "/deliveries/{id}/files",
            get(list)
                .post(upload)
                .layer(DefaultBodyLimit::max(MAX_FILE_BYTES)),
        )
        .route("/files/{id}", get(download))
}

/// Корень хранилища: FILES_DIR или data/files рядом с приложением (для разработки).
fn files_dir() -> PathBuf {
    std::env::var("FILES_DIR").map_or_else(|_| PathBuf::from("data/files"), PathBuf::from)
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct DeliveryFile {
    id: Uuid,
    name: String,
    content_type: String,
    size: i64,
    uploaded_by: String,
    uploaded_at: DateTime<Utc>,
}

/// Тип по сигнатуре содержимого, а не по расширению: принимаются только jpg, png и pdf.
fn detect_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if bytes.starts_with(b"%PDF-") {
        Some(("application/pdf", "pdf"))
    } else {
        None
    }
}

/// Имя файла для сетевой папки: буквы (в т. ч. кириллица), цифры, «-», «_», «.»; остальное — «_».
fn safe_name(name: &str, extension: &str) -> String {
    let stem = std::path::Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("document");
    let cleaned: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    let cleaned = cleaned.trim_matches(['_', '.']);
    let stem = if cleaned.is_empty() {
        "document"
    } else {
        cleaned
    };
    format!("{stem}.{extension}")
}

/// RFC 5987: имя файла с кириллицей в заголовке Content-Disposition.
fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

async fn list(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<Json<Vec<DeliveryFile>>> {
    let rows = sqlx::query_as::<_, DeliveryFile>(
        "SELECT id, name, content_type, size, uploaded_by, uploaded_at FROM delivery_files \
         WHERE delivery_id = $1 ORDER BY uploaded_at",
    )
    .bind(id)
    .fetch_all(&db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
struct UploadQuery {
    name: String,
}

async fn upload(
    State(db): State<Db>,
    Path(delivery_id): Path<Uuid>,
    Query(query): Query<UploadQuery>,
    body: Bytes,
) -> AppResult<(StatusCode, Json<DeliveryFile>)> {
    let user = auth::current().ok_or(AppError::Unauthorized)?;
    if body.is_empty() {
        return Err(AppError::Validation("Файл пустой".into()));
    }
    let (content_type, extension) = detect_type(&body)
        .ok_or_else(|| AppError::Validation("Можно прикрепить только JPG, PNG или PDF".into()))?;
    let number = sqlx::query_scalar::<_, String>("SELECT number FROM deliveries WHERE id = $1")
        .bind(delivery_id)
        .fetch_optional(&db)
        .await?
        .ok_or_else(|| AppError::NotFound("Поставка не найдена".into()))?;

    let file_id = Uuid::new_v4();
    let name = safe_name(&query.name, extension);
    // Подпапка — номер поставки: в сетевой папке документы лежат по поставкам.
    let relative = format!("{number}/{}-{name}", &file_id.simple().to_string()[..8]);
    let full = files_dir().join(&relative);
    let write = async {
        tokio::fs::create_dir_all(full.parent().expect("путь внутри папки поставки")).await?;
        let temp = full.with_extension("part");
        tokio::fs::write(&temp, &body).await?;
        tokio::fs::rename(&temp, &full).await
    };
    write.await.map_err(|e| {
        tracing::error!(error = %e, path = %full.display(), "не удалось сохранить файл");
        AppError::Conflict(
            "Не удалось сохранить файл на сервере — проверьте папку FILES_DIR".into(),
        )
    })?;

    let mut tx = db.begin().await?;
    let row = sqlx::query_as::<_, DeliveryFile>(
        "INSERT INTO delivery_files (id, delivery_id, name, content_type, size, path, uploaded_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         RETURNING id, name, content_type, size, uploaded_by, uploaded_at",
    )
    .bind(file_id)
    .bind(delivery_id)
    .bind(&name)
    .bind(content_type)
    .bind(body.len() as i64)
    .bind(&relative)
    .bind(&user.login)
    .fetch_one(&mut *tx)
    .await?;
    audit::record(
        &mut *tx,
        "delivery",
        delivery_id,
        "attach",
        json!({ "file": name, "size": body.len() }),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn download(State(db): State<Db>, Path(id): Path<Uuid>) -> AppResult<impl IntoResponse> {
    let (name, content_type, path) = sqlx::query_as::<_, (String, String, String)>(
        "SELECT name, content_type, path FROM delivery_files WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&db)
    .await?
    .ok_or_else(|| AppError::NotFound("Файл не найден".into()))?;
    let bytes = tokio::fs::read(files_dir().join(&path))
        .await
        .map_err(|_| {
            AppError::NotFound(format!(
                "Файл «{name}» есть в учёте, но не найден в папке хранения"
            ))
        })?;
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (
                header::CONTENT_DISPOSITION,
                format!(
                    "inline; filename=\"document\"; filename*=UTF-8''{}",
                    percent_encode(&name)
                ),
            ),
        ],
        bytes,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_only_allowed_types() {
        assert_eq!(
            detect_type(b"\xFF\xD8\xFF\xE0rest").unwrap().0,
            "image/jpeg"
        );
        assert_eq!(
            detect_type(b"\x89PNG\r\n\x1a\nrest").unwrap().0,
            "image/png"
        );
        assert_eq!(detect_type(b"%PDF-1.7").unwrap().0, "application/pdf");
        assert!(detect_type(b"MZ\x90\x00").is_none());
        assert!(detect_type(b"<html>").is_none());
    }

    #[test]
    fn names_are_safe_for_network_folder() {
        assert_eq!(
            safe_name("ТН №15 от 01.11.pdf", "pdf"),
            "ТН__15_от_01.11.pdf"
        );
        assert_eq!(safe_name("../../etc/passwd", "pdf"), "passwd.pdf");
        assert_eq!(safe_name("скан.exe", "jpg"), "скан.jpg");
        assert_eq!(safe_name("???", "png"), "document.png");
    }

    #[test]
    fn encodes_cyrillic_filename() {
        assert_eq!(percent_encode("ТН.pdf"), "%D0%A2%D0%9D.pdf");
    }
}
