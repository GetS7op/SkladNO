//! Импорт справочников из CSV или XLSX: модели устройств и клиенты.
//! Колонки узнаются по заголовкам (как в выгрузке SkladNO). Каждая строка проверяется теми же правилами,
//! что ручной ввод; уже существующие записи пропускаются; пробный прогон ничего не записывает.

use std::{collections::HashMap, io::Cursor};

use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query, State},
};
use calamine::{Data, Reader, Xlsx};
use serde::{Deserialize, Serialize};
use skladno_catalog::DeviceModelInput;
use skladno_clients::ClientInput;
use skladno_core::{AppError, AppResult, Db};
use sqlx::Acquire;

pub(crate) const MAX_ROWS: usize = 10_000;

#[derive(Deserialize)]
pub struct ImportQuery {
    #[serde(default)]
    dry_run: bool,
}

#[derive(Serialize)]
pub struct RowError {
    /// Номер строки в файле (шапка — строка 1).
    pub(crate) row: usize,
    pub(crate) message: String,
}

#[derive(Serialize)]
pub struct ImportReport {
    dry_run: bool,
    total: usize,
    created: usize,
    skipped: usize,
    errors: Vec<RowError>,
}

/// Таблица из файла: строки ячеек-строк, первая непустая строка — шапка.
pub(crate) fn read_rows(bytes: &[u8]) -> AppResult<Vec<Vec<String>>> {
    let rows = if bytes.starts_with(b"PK") {
        read_xlsx(bytes)?
    } else {
        read_csv(&decode_text(bytes))
    };
    Ok(rows
        .into_iter()
        .map(|r| {
            r.into_iter()
                .map(|c| c.trim().to_string())
                .collect::<Vec<_>>()
        })
        .collect())
}

fn read_xlsx(bytes: &[u8]) -> AppResult<Vec<Vec<String>>> {
    let mut book = Xlsx::new(Cursor::new(bytes.to_vec()))
        .map_err(|e| AppError::Validation(format!("Не удалось открыть XLSX: {e}")))?;
    let range = book
        .worksheet_range_at(0)
        .ok_or_else(|| AppError::Validation("В XLSX нет листов".into()))?
        .map_err(|e| AppError::Validation(format!("Не удалось прочитать лист XLSX: {e}")))?;
    Ok(range
        .rows()
        .map(|row| {
            row.iter()
                .map(|cell| match cell {
                    Data::Empty => String::new(),
                    Data::String(s) => s.clone(),
                    Data::Float(f) if f.fract() == 0.0 && f.abs() < 1e15 => {
                        format!("{}", *f as i64)
                    }
                    Data::Float(f) => f.to_string(),
                    Data::Int(i) => i.to_string(),
                    Data::Bool(b) => if *b { "да" } else { "нет" }.to_string(),
                    other => other.to_string(),
                })
                .collect()
        })
        .collect())
}

/// UTF-8 (с BOM или без); если не UTF-8 — Windows-1251, в ней сохраняет CSV русский Excel.
fn decode_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => encoding_rs::WINDOWS_1251.decode(bytes).0.into_owned(),
    }
}

/// CSV с разделителем «;», «,» или табуляцией (выбирается по шапке), поля в кавычках по RFC 4180.
fn read_csv(text: &str) -> Vec<Vec<String>> {
    let first_line = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let delimiter = [';', '\t', ',']
        .into_iter()
        .max_by_key(|d| first_line.matches(*d).count())
        .unwrap_or(';');
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            c if c == delimiter && !quoted => row.push(std::mem::take(&mut field)),
            '\r' if !quoted => {}
            '\n' if !quoted => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            c => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

/// Колонки по шапке: «Потребление, Вт» → «потребление». Возвращает индекс колонки по ключу.
pub(crate) fn header_index(
    header: &[String],
    aliases: &[(&'static str, &[&str])],
) -> HashMap<&'static str, usize> {
    let mut found = HashMap::new();
    for (i, title) in header.iter().enumerate() {
        let base = title.split(',').next().unwrap_or("").trim().to_lowercase();
        for (key, names) in aliases {
            if names.contains(&base.as_str()) && !found.contains_key(key) {
                found.insert(*key, i);
            }
        }
    }
    found
}

const MODEL_COLUMNS: &[(&str, &[&str])] = &[
    ("manufacturer", &["производитель", "manufacturer"]),
    ("model", &["модель", "model"]),
    ("hashrate", &["xp", "хешрейт", "hashrate"]),
    ("power", &["потребление", "энергопотребление", "power"]),
    ("dimensions", &["размеры", "dimensions"]),
    ("weight", &["вес", "weight"]),
];

const CLIENT_COLUMNS: &[(&str, &[&str])] = &[
    ("name", &["наименование", "клиент", "name"]),
    ("note", &["заметка", "note"]),
];

fn number(value: &str, label: &str) -> Result<Option<f64>, String> {
    let v = value.replace([' ', '\u{a0}'], "").replace(',', ".");
    if v.is_empty() {
        return Ok(None);
    }
    v.parse::<f64>()
        .map(Some)
        .map_err(|_| format!("{label}: «{value}» — не число"))
}

pub async fn import(
    State(db): State<Db>,
    Path(name): Path<String>,
    Query(query): Query<ImportQuery>,
    body: Bytes,
) -> AppResult<Json<ImportReport>> {
    let (columns, required): (&[(&'static str, &[&str])], &[&str]) = match name.as_str() {
        "devices" => (MODEL_COLUMNS, &["manufacturer", "model"]),
        "clients" => (CLIENT_COLUMNS, &["name"]),
        _ => {
            return Err(AppError::NotFound(
                "Импорт есть для реестров devices и clients".into(),
            ));
        }
    };
    if body.is_empty() {
        return Err(AppError::Validation("Файл пустой".into()));
    }
    let rows = read_rows(&body)?;
    let Some(header_pos) = rows.iter().position(|r| r.iter().any(|c| !c.is_empty())) else {
        return Err(AppError::Validation("В файле нет данных".into()));
    };
    let index = header_index(&rows[header_pos], columns);
    if let Some(missing) = required.iter().find(|k| !index.contains_key(**k)) {
        let title = match *missing {
            "manufacturer" => "Производитель",
            "model" => "Модель",
            _ => "Наименование",
        };
        return Err(AppError::Validation(format!(
            "Нет колонки «{title}». Шапка должна быть как в выгрузке SkladNO"
        )));
    }
    let data: Vec<(usize, &Vec<String>)> = rows
        .iter()
        .enumerate()
        .skip(header_pos + 1)
        .filter(|(_, r)| r.iter().any(|c| !c.is_empty()))
        .map(|(i, r)| (i + 1, r))
        .collect();
    if data.len() > MAX_ROWS {
        return Err(AppError::Validation(format!(
            "Не больше {MAX_ROWS} строк за один импорт"
        )));
    }

    let mut report = ImportReport {
        dry_run: query.dry_run,
        total: data.len(),
        created: 0,
        skipped: 0,
        errors: Vec::new(),
    };
    let mut tx = db.begin().await?;
    for (line, row) in data {
        let cell = |key: &str| {
            index
                .get(key)
                .and_then(|i| row.get(*i))
                .cloned()
                .unwrap_or_default()
        };
        // Каждая строка — в своей точке сохранения: ошибка одной строки не отменяет остальные.
        let mut savepoint = (&mut *tx).begin().await?;
        let outcome = match name.as_str() {
            "devices" => {
                let parsed = number(&cell("hashrate"), "XP").and_then(|xp| {
                    let power = number(&cell("power"), "Потребление")?;
                    Ok((xp, power))
                });
                match parsed {
                    Err(message) => Err(AppError::Validation(message)),
                    Ok((hashrate_ths, power)) => {
                        let input = DeviceModelInput {
                            manufacturer: cell("manufacturer"),
                            model: cell("model"),
                            hashrate_ths,
                            power_w: power.map(|p| p.round() as i32),
                            dimensions_mm: Some(cell("dimensions")),
                            weight_kg: Some(cell("weight")),
                        };
                        skladno_catalog::import_one(&mut savepoint, input).await
                    }
                }
            }
            _ => {
                let note = cell("note");
                let input = ClientInput {
                    name: cell("name"),
                    note: (!note.is_empty()).then_some(note),
                };
                skladno_clients::import_one(&mut savepoint, input).await
            }
        };
        match outcome {
            Ok(created) => {
                savepoint.commit().await?;
                if created {
                    report.created += 1
                } else {
                    report.skipped += 1
                }
            }
            Err(AppError::Db(e)) => return Err(AppError::Db(e)),
            Err(e) => {
                savepoint.rollback().await?;
                report.errors.push(RowError {
                    row: line,
                    message: e.to_string(),
                });
            }
        }
    }
    if query.dry_run {
        tx.rollback().await?;
    } else {
        tx.commit().await?;
    }
    Ok(Json(report))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_with_quotes_and_semicolons() {
        let rows =
            read_csv("Производитель;Модель\r\n\"Bit;main\";\"S21 \"\"Pro\"\"\"\r\nMicroBT;M60\n");
        assert_eq!(rows[1], vec!["Bit;main", "S21 \"Pro\""]);
        assert_eq!(rows[2], vec!["MicroBT", "M60"]);
    }

    #[test]
    fn detects_comma_delimiter_and_cp1251() {
        let (bytes, _, _) =
            encoding_rs::WINDOWS_1251.encode("Наименование,Заметка\nООО Ромашка,тест\n");
        let rows = read_csv(&decode_text(&bytes));
        assert_eq!(rows[1], vec!["ООО Ромашка", "тест"]);
    }

    #[test]
    fn headers_match_export_titles() {
        let header: Vec<String> = ["Модель", "Производитель", "XP, Th/s", "Потребление, Вт"]
            .map(String::from)
            .to_vec();
        let index = header_index(&header, MODEL_COLUMNS);
        assert_eq!(index["model"], 0);
        assert_eq!(index["manufacturer"], 1);
        assert_eq!(index["hashrate"], 2);
        assert_eq!(index["power"], 3);
    }

    #[test]
    fn numbers_accept_comma() {
        assert_eq!(number("200,5", "XP"), Ok(Some(200.5)));
        assert_eq!(number("", "XP"), Ok(None));
        assert!(number("abc", "XP").is_err());
    }

    #[test]
    fn xlsx_roundtrip_with_export() {
        let table = crate::table::Table {
            title: "t".into(),
            file: "t".into(),
            columns: vec!["Производитель", "Модель", "XP, Th/s"],
            rows: vec![vec!["Bitmain".into(), "S21".into(), 200i64.into()]],
            stats: vec![],
        };
        let bytes = crate::table::to_xlsx(&table, "now").unwrap();
        let rows = read_rows(&bytes).unwrap();
        assert_eq!(rows[1], vec!["Bitmain", "S21", "200"]);
    }
}
