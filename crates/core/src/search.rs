//! Строка поиска устройств, как в mf-old: несколько критериев сразу, каждый понимается по виду.
//!
//! Критерии разделяются запятой, точкой с запятой, табуляцией или переносом строки; пробел тоже
//! разделяет, если среди частей есть номер, диапазон или MAC («1-4 AA:BB…»). Иначе строка с
//! пробелами — один текст («Antminer S21»). Число — INDEX (5 и 0000005 одно и то же), «1-4» —
//! диапазон INDEX, MAC — в любом написании, остальное — текст по модели, серийному, клиенту и т. д.

use crate::text::normalize_mac;

/// Цифр в INDEX.
const INDEX_DIGITS: usize = 7;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Criterion {
    /// INDEX в виде 7 цифр.
    Index(String),
    /// Диапазон INDEX включительно, обе границы — 7 цифр.
    Range(String, String),
    /// MAC в виде AA:BB:CC:DD:EE:FF.
    Mac(String),
    Text(String),
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct DeviceSearch {
    pub criteria: Vec<Criterion>,
}

fn as_index(token: &str) -> Option<String> {
    let digits = token.trim();
    (!digits.is_empty()
        && digits.len() <= INDEX_DIGITS
        && digits.chars().all(|c| c.is_ascii_digit()))
    .then(|| format!("{:0>width$}", digits, width = INDEX_DIGITS))
}

fn as_range(token: &str) -> Option<(String, String)> {
    let (a, b) = token.split_once('-')?;
    let (a, b) = (as_index(a)?, as_index(b)?);
    Some(if a <= b { (a, b) } else { (b, a) })
}

/// MAC: 12 шестнадцатеричных цифр с разделителями или без; 12 цифр подряд — тоже MAC.
fn as_mac(token: &str) -> Option<String> {
    normalize_mac(token).ok()
}

fn simple(token: &str) -> bool {
    as_index(token).is_some() || as_range(token).is_some() || as_mac(token).is_some()
}

/// Делит по запятым и переносам; каждую часть — ещё и по пробелам, если в ней есть номер или MAC.
fn split(text: &str) -> Vec<String> {
    let hard = |c: char| matches!(c, ',' | ';' | '\t' | '\n' | '\r');
    text.split(hard)
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .flat_map(|part| {
            let words: Vec<&str> = part.split_whitespace().collect();
            if words.len() > 1 && words.iter().any(|w| simple(w)) {
                words.into_iter().map(String::from).collect()
            } else {
                vec![words.join(" ")]
            }
        })
        .collect()
}

impl DeviceSearch {
    pub fn parse(text: &str) -> Self {
        let mut criteria: Vec<Criterion> = Vec::new();
        for token in split(text) {
            let criterion = if let Some(index) = as_index(&token) {
                Criterion::Index(index)
            } else if let Some((a, b)) = as_range(&token) {
                Criterion::Range(a, b)
            } else if let Some(mac) = as_mac(&token) {
                Criterion::Mac(mac)
            } else {
                Criterion::Text(token)
            };
            if !criteria.contains(&criterion) {
                criteria.push(criterion);
            }
        }
        Self { criteria }
    }

    pub fn is_empty(&self) -> bool {
        self.criteria.is_empty()
    }

    /// Что поняла строка поиска — для подписи под полем: «номера 0000001–0000003; MAC …».
    pub fn summary(&self, exact: bool) -> String {
        let mut numbers = Vec::new();
        let mut macs = Vec::new();
        let mut texts = Vec::new();
        for c in &self.criteria {
            match c {
                Criterion::Index(i) => numbers.push(i.clone()),
                Criterion::Range(a, b) => numbers.push(format!("{a}–{b}")),
                Criterion::Mac(m) => macs.push(m.clone()),
                Criterion::Text(t) => texts.push(format!("«{t}»")),
            }
        }
        let mut parts = Vec::new();
        if !numbers.is_empty() {
            parts.push(format!("номера {}", numbers.join(", ")));
        }
        if !macs.is_empty() {
            parts.push(format!("MAC {}", macs.join(", ")));
        }
        if !texts.is_empty() {
            parts.push(format!("текст {}", texts.join(", ")));
        }
        if exact && self.criteria.len() > 1 {
            format!("все сразу: {}", parts.join(" и "))
        } else {
            parts.join("; ")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Criterion::*, DeviceSearch};

    fn parse(text: &str) -> Vec<super::Criterion> {
        DeviceSearch::parse(text).criteria
    }

    #[test]
    fn numbers_ranges_and_macs() {
        assert_eq!(parse("5"), [Index("0000005".into())]);
        assert_eq!(
            parse("0000001-4 0000005"),
            [
                Range("0000001".into(), "0000004".into()),
                Index("0000005".into())
            ]
        );
        assert_eq!(parse("9-7"), [Range("0000007".into(), "0000009".into())]);
        assert_eq!(parse("ce0b0c002843"), [Mac("CE:0B:0C:00:28:43".into())]);
        assert_eq!(
            parse("CE-0B-0C-00-28-43"),
            [Mac("CE:0B:0C:00:28:43".into())]
        );
    }

    #[test]
    fn text_with_spaces_stays_whole() {
        assert_eq!(parse("Antminer S21"), [Text("Antminer S21".into())]);
        assert_eq!(parse("  "), []);
    }

    #[test]
    fn separators_mix() {
        assert_eq!(
            parse("1-3 ce0b0c002843"),
            [
                Range("0000001".into(), "0000003".into()),
                Mac("CE:0B:0C:00:28:43".into())
            ]
        );
        assert_eq!(
            parse("Antminer S21; 7\nООО Майнинг"),
            [
                Text("Antminer S21".into()),
                Index("0000007".into()),
                Text("ООО Майнинг".into())
            ]
        );
        assert_eq!(parse("5, 5, 0000005"), [Index("0000005".into())]);
    }

    #[test]
    fn summary() {
        let s = DeviceSearch::parse("1-3 ce0b0c002843 M60S, 7");
        assert_eq!(
            s.summary(false),
            "номера 0000001–0000003, 0000007; MAC CE:0B:0C:00:28:43; текст «M60S»"
        );
        assert!(s.summary(true).starts_with("все сразу: "));
    }
}
