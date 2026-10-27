/// R-02: «Размеры» принимают числа и разделители, сохраняются как «AxBxC» (мм).
pub fn format_dimensions(raw: Option<&str>) -> Result<Option<String>, String> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if let Some(bad) = raw
        .chars()
        .find(|c| !(c.is_ascii_digit() || c.is_whitespace() || "xXхХ×*,;/-".contains(*c)))
    {
        return Err(format!("Недопустимый символ «{bad}» в размерах"));
    }
    let numbers = raw
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Слишком большое число в размерах".to_string())?;
    match numbers.as_slice() {
        [a, b, c] if *a > 0 && *b > 0 && *c > 0 => Ok(Some(format!("{a}x{b}x{c}"))),
        _ => Err("Размеры: укажите три числа больше нуля, например 400 195 290".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::format_dimensions;

    #[test]
    fn formats_any_separators() {
        for raw in [
            "400 195 290",
            "400x195x290",
            "400 х 195 Х 290",
            "400*195*290",
            " 400,195;290 ",
        ] {
            assert_eq!(
                format_dimensions(Some(raw)),
                Ok(Some("400x195x290".into())),
                "{raw}"
            );
        }
    }

    #[test]
    fn empty_is_none() {
        assert_eq!(format_dimensions(None), Ok(None));
        assert_eq!(format_dimensions(Some("   ")), Ok(None));
    }

    #[test]
    fn rejects_bad_input() {
        assert!(format_dimensions(Some("400 195")).is_err());
        assert!(format_dimensions(Some("400 195 290 10")).is_err());
        assert!(format_dimensions(Some("400 0 290")).is_err());
        assert!(format_dimensions(Some("400мм 195 290")).is_err());
    }
}
