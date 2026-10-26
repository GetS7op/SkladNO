//! D-06: адрес места `MXCXSXP` — модуль, контейнер, стеллаж, полка; разделитель «X».

/// Разделитель адреса. В SPEC он задаётся в настройках; пока настроек нет — постоянный «X».
pub const SEPARATOR: char = 'X';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Address {
    pub module: i32,
    pub container: i32,
    pub rack: i32,
    pub shelf: i32,
}

pub fn format_address(module: i32, container: i32, rack: i32, shelf: i32) -> String {
    format!("{module}{SEPARATOR}{container}{SEPARATOR}{rack}{SEPARATOR}{shelf}")
}

impl Address {
    /// Разбирает штрихкод полки. Принимает латинскую и кириллическую «X» в любом регистре,
    /// потому что сканер в русской раскладке вводит «Х».
    pub fn parse(code: &str) -> Result<Address, String> {
        let parts: Vec<&str> = code.trim().split(['X', 'x', 'Х', 'х']).collect();
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
            }),
            _ => Err(format!(
                "Штрихкод полки «{}» не похож на адрес вида 1X2X3X4",
                code.trim()
            )),
        }
    }
}

impl std::fmt::Display for Address {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&format_address(self.module, self.container, self.rack, self.shelf))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_any_x() {
        let expected = Address { module: 1, container: 12, rack: 3, shelf: 4 };
        for code in ["1X12X3X4", "1x12x3x4", " 1Х12х3Х4 "] {
            assert_eq!(Address::parse(code), Ok(expected), "{code}");
        }
        assert_eq!(expected.to_string(), "1X12X3X4");
    }

    #[test]
    fn rejects_bad_codes() {
        for code in ["", "1X2X3", "1X2X3X4X5", "0X1X1X1", "AX1X1X1", "0000001"] {
            assert!(Address::parse(code).is_err(), "{code}");
        }
    }
}
