//! Таблица отчёта и её выгрузка в CSV, XLSX и MD (со статистикой).

use rust_xlsxwriter::{Format, Workbook, XlsxError};

#[derive(Debug, Clone)]
pub enum Cell {
    Text(String),
    Int(i64),
    Num(f64),
    Empty,
}

impl Cell {
    fn as_text(&self) -> String {
        match self {
            Cell::Text(s) => s.clone(),
            Cell::Int(n) => n.to_string(),
            Cell::Num(n) => format!("{n}").replace('.', ","),
            Cell::Empty => String::new(),
        }
    }
}

impl From<String> for Cell {
    fn from(v: String) -> Self {
        Cell::Text(v)
    }
}
impl From<&str> for Cell {
    fn from(v: &str) -> Self {
        Cell::Text(v.to_string())
    }
}
impl From<i64> for Cell {
    fn from(v: i64) -> Self {
        Cell::Int(v)
    }
}
impl From<i32> for Cell {
    fn from(v: i32) -> Self {
        Cell::Int(v.into())
    }
}
impl From<f64> for Cell {
    fn from(v: f64) -> Self {
        Cell::Num(v)
    }
}
impl<T: Into<Cell>> From<Option<T>> for Cell {
    fn from(v: Option<T>) -> Self {
        v.map_or(Cell::Empty, Into::into)
    }
}

#[derive(Debug, Clone)]
pub struct Table {
    /// Заголовок отчёта, он же имя файла.
    pub title: String,
    /// Имя файла без расширения (латиница).
    pub file: String,
    pub columns: Vec<&'static str>,
    pub rows: Vec<Vec<Cell>>,
    /// Статистика: «показатель — значение».
    pub stats: Vec<(String, Cell)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Csv,
    Xlsx,
    Md,
}

impl ExportFormat {
    pub fn parse(value: &str) -> Option<ExportFormat> {
        match value {
            "csv" => Some(ExportFormat::Csv),
            "xlsx" => Some(ExportFormat::Xlsx),
            "md" => Some(ExportFormat::Md),
            _ => None,
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            ExportFormat::Csv => "csv",
            ExportFormat::Xlsx => "xlsx",
            ExportFormat::Md => "md",
        }
    }

    pub fn content_type(self) -> &'static str {
        match self {
            ExportFormat::Csv => "text/csv; charset=utf-8",
            ExportFormat::Xlsx => {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            }
            ExportFormat::Md => "text/markdown; charset=utf-8",
        }
    }
}

/// CSV с разделителем «;» и BOM — открывается в Excel без настройки кодировки.
pub fn to_csv(table: &Table) -> Vec<u8> {
    let field = |v: String| {
        if v.contains([';', '"', '\n', '\r']) {
            format!("\"{}\"", v.replace('"', "\"\""))
        } else {
            v
        }
    };
    let mut out = String::from("\u{feff}");
    out.push_str(
        &table
            .columns
            .iter()
            .map(|c| field((*c).to_string()))
            .collect::<Vec<_>>()
            .join(";"),
    );
    out.push_str("\r\n");
    for row in &table.rows {
        out.push_str(
            &row.iter()
                .map(|c| field(c.as_text()))
                .collect::<Vec<_>>()
                .join(";"),
        );
        out.push_str("\r\n");
    }
    out.into_bytes()
}

/// Markdown-отчёт: заголовок, дата, статистика, затем данные.
pub fn to_md(table: &Table, generated: &str) -> Vec<u8> {
    let esc = |v: String| v.replace('|', "\\|").replace(['\n', '\r'], " ");
    let mut out = format!(
        "# {}\n\nСформировано: {generated}\n\n## Статистика\n\n| Показатель | Значение |\n|---|---|\n",
        table.title
    );
    for (name, value) in &table.stats {
        out.push_str(&format!(
            "| {} | {} |\n",
            esc(name.clone()),
            esc(value.as_text())
        ));
    }
    out.push_str(&format!("\n## Данные ({} строк)\n\n", table.rows.len()));
    out.push_str(&format!("| {} |\n", table.columns.join(" | ")));
    out.push_str(&format!("|{}\n", "---|".repeat(table.columns.len())));
    for row in &table.rows {
        out.push_str(&format!(
            "| {} |\n",
            row.iter()
                .map(|c| esc(c.as_text()))
                .collect::<Vec<_>>()
                .join(" | ")
        ));
    }
    out.into_bytes()
}

/// XLSX: лист «Данные» (закреплённая шапка, автофильтр) и лист «Статистика».
pub fn to_xlsx(table: &Table, generated: &str) -> Result<Vec<u8>, XlsxError> {
    let mut workbook = Workbook::new();
    let bold = Format::new().set_bold();
    let header = Format::new().set_bold().set_background_color("E8E7E0");

    let data = workbook.add_worksheet();
    data.set_name("Данные")?;
    for (col, name) in table.columns.iter().enumerate() {
        data.write_with_format(0, col as u16, *name, &header)?;
    }
    for (r, row) in table.rows.iter().enumerate() {
        let r = (r + 1) as u32;
        for (c, cell) in row.iter().enumerate() {
            let c = c as u16;
            match cell {
                Cell::Text(s) => data.write_string(r, c, s).map(|_| ())?,
                Cell::Int(n) => data.write_number(r, c, *n as f64).map(|_| ())?,
                Cell::Num(n) => data.write_number(r, c, *n).map(|_| ())?,
                Cell::Empty => {}
            }
        }
    }
    data.set_freeze_panes(1, 0)?;
    if !table.columns.is_empty() {
        data.autofilter(
            0,
            0,
            table.rows.len() as u32,
            (table.columns.len() - 1) as u16,
        )?;
    }
    data.autofit();

    let stats = workbook.add_worksheet();
    stats.set_name("Статистика")?;
    stats.write_with_format(0, 0, table.title.as_str(), &bold)?;
    stats.write_string(1, 0, format!("Сформировано: {generated}"))?;
    stats.write_with_format(3, 0, "Показатель", &header)?;
    stats.write_with_format(3, 1, "Значение", &header)?;
    for (i, (name, value)) in table.stats.iter().enumerate() {
        let r = (i + 4) as u32;
        stats.write_string(r, 0, name)?;
        match value {
            Cell::Int(n) => stats.write_number(r, 1, *n as f64).map(|_| ())?,
            Cell::Num(n) => stats.write_number(r, 1, *n).map(|_| ())?,
            other => stats.write_string(r, 1, other.as_text()).map(|_| ())?,
        }
    }
    stats.autofit();
    workbook.save_to_buffer()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Table {
        Table {
            title: "Тест".into(),
            file: "test".into(),
            columns: vec!["Имя", "Кол-во", "XP"],
            rows: vec![
                vec!["А; Б".into(), 3i64.into(), 1.5.into()],
                vec!["В|Г".into(), Cell::Empty, Option::<f64>::None.into()],
            ],
            stats: vec![("Строк".into(), 2i64.into())],
        }
    }

    #[test]
    fn csv_escapes_and_has_bom() {
        let csv = String::from_utf8(to_csv(&sample())).unwrap();
        assert!(csv.starts_with('\u{feff}'));
        assert!(csv.contains("\"А; Б\";3;1,5\r\n"));
    }

    #[test]
    fn md_has_stats_and_escapes_pipes() {
        let md = String::from_utf8(to_md(&sample(), "сегодня")).unwrap();
        assert!(md.contains("| Строк | 2 |"));
        assert!(md.contains("В\\|Г"));
        assert!(md.contains("## Данные (2 строк)"));
    }

    #[test]
    fn xlsx_is_zip() {
        let bytes = to_xlsx(&sample(), "сегодня").unwrap();
        assert_eq!(&bytes[..2], b"PK");
    }
}
