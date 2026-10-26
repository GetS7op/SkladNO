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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_pattern_escapes_wildcards() {
        assert_eq!(like_pattern(Some(" 50%_ ")), Some("%50\\%\\_%".into()));
        assert_eq!(like_pattern(Some("  ")), None);
    }
}
