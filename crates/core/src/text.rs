/// Обрезает пробелы; пустую строку превращает в None.
pub fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Шаблон для ILIKE: экранирует спецсимволы и ищет подстроку. None, если искать нечего.
pub fn like_pattern(query: Option<&str>) -> Option<String> {
    let query = query?.trim();
    if query.is_empty() {
        return None;
    }
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    Some(format!("%{escaped}%"))
}

/// MAC в виде AA:BB:CC:DD:EE:FF; принимает разделители «:», «-», «.» или без них.
pub fn normalize_mac(raw: &str) -> Result<String, String> {
    let hex: String = raw.chars().filter(|c| !matches!(c, ':' | '-' | '.' | ' ')).collect();
    if hex.len() != 12 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("MAC «{}» — нужно 12 шестнадцатеричных цифр, например CE:0B:0C:00:29:0A", raw.trim()));
    }
    let upper = hex.to_ascii_uppercase();
    Ok(upper.as_bytes().chunks(2).map(|c| std::str::from_utf8(c).unwrap_or("")).collect::<Vec<_>>().join(":"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_pattern_escapes_wildcards() {
        assert_eq!(like_pattern(Some(" 50%_ ")), Some("%50\\%\\_%".into()));
        assert_eq!(like_pattern(Some("  ")), None);
    }

    #[test]
    fn mac_formats() {
        for raw in ["CE:0B:0C:00:29:0A", "ce-0b-0c-00-29-0a", "ce0b0c00290a", " CE.0B.0C.00.29.0A "] {
            assert_eq!(normalize_mac(raw).unwrap(), "CE:0B:0C:00:29:0A", "{raw}");
        }
        assert!(normalize_mac("CE:0B:0C:00:29").is_err());
        assert!(normalize_mac("ZZ:0B:0C:00:29:0A").is_err());
    }
}
