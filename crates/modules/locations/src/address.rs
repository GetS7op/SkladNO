//! D-06: адрес места `MXCXSXP` — модуль, контейнер, стеллаж, полка; разделитель задаётся
//! в настройках (по умолчанию «X»).

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Address {
    pub module: i32,
    pub container: i32,
    pub rack: i32,
    pub shelf: i32,
    /// Разделитель, которым адрес выводится (текущая настройка).
    pub separator: String,
}

impl Address {
    /// Разбирает штрихкод полки. Всегда принимает латинскую и кириллическую «X» в любом регистре
    /// (сканер в русской раскладке вводит «Х», а наклейки, напечатанные до смены настройки,
    /// продолжают читаться), а также текущий разделитель.
    pub fn parse(code: &str, separator: &str) -> Result<Address, String> {
        let normalized = if separator.is_empty() {
            code.to_string()
        } else {
            code.replace(separator, "X")
        };
        let parts: Vec<&str> = normalized.trim().split(['X', 'x', 'Х', 'х']).collect();
        let numbers = parts
            .iter()
            .map(|p| p.trim().parse::<i32>().ok().filter(|n| *n > 0))
            .collect::<Option<Vec<_>>>();
        match numbers.as_deref() {
            Some([module, container, rack, shelf]) => Ok(Address {
                module: *module,
                container: *container,
                rack: *rack,
                shelf: *shelf,
                separator: separator.to_string(),
            }),
            _ => Err(format!(
                "Штрихкод полки «{}» не похож на адрес вида 1{separator}2{separator}3{separator}4",
                code.trim()
            )),
        }
    }
}

impl std::fmt::Display for Address {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = &self.separator;
        write!(
            f,
            "{}{s}{}{s}{}{s}{}",
            self.module, self.container, self.rack, self.shelf
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_any_x() {
        for code in ["1X12X3X4", "1x12x3x4", " 1Х12х3Х4 "] {
            let a = Address::parse(code, "X").unwrap();
            assert_eq!(
                (a.module, a.container, a.rack, a.shelf),
                (1, 12, 3, 4),
                "{code}"
            );
        }
        assert_eq!(
            Address::parse("1X12X3X4", "X").unwrap().to_string(),
            "1X12X3X4"
        );
    }

    #[test]
    fn custom_separator_and_old_labels() {
        let a = Address::parse("1-12-3-4", "-").unwrap();
        assert_eq!(a.to_string(), "1-12-3-4");
        // Наклейка, напечатанная до смены разделителя, читается и выводится по-новому.
        assert_eq!(
            Address::parse("1X12X3X4", "-").unwrap().to_string(),
            "1-12-3-4"
        );
        assert_eq!(
            Address::parse("1.2.3.4", ".").unwrap().to_string(),
            "1.2.3.4"
        );
    }

    #[test]
    fn rejects_bad_codes() {
        for code in ["", "1X2X3", "1X2X3X4X5", "0X1X1X1", "AX1X1X1", "0000001"] {
            assert!(Address::parse(code, "X").is_err(), "{code}");
        }
    }
}
