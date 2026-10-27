//! Index устройства: 7 цифр, раздельные диапазоны для «Парка» и «Мастерской», неизменяемый.

use uuid::Uuid;

/// Пространство имён для детерминированных UUID v5 устройств. Менять нельзя:
/// иначе одно и то же устройство получит другой UUID.
const DEVICE_NAMESPACE: Uuid = Uuid::from_u128(0x5c1a_d0e0_7d1e_4c3a_9b51_9e0d_51ad_0001);

pub fn format_index(value: i32) -> String {
    format!("{value:07}")
}

/// UUID v5 (SHA-1) от Index: один и тот же Index всегда даёт один и тот же UUID,
/// поэтому ТСД и сервер вычисляют идентификатор устройства независимо.
pub fn device_uuid(index: &str) -> Uuid {
    Uuid::new_v5(
        &DEVICE_NAMESPACE,
        format!("skladno:device:{index}").as_bytes(),
    )
}

/// Выделяет `count` подряд идущих Index начиная с `next`. None — диапазон исчерпан (Q-04).
pub fn allocate(next: i32, max: i32, count: i32) -> Option<Vec<String>> {
    let last = next.checked_add(count)?.checked_sub(1)?;
    (count > 0 && last <= max).then(|| (next..=last).map(format_index).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_is_seven_digits() {
        assert_eq!(format_index(1), "0000001");
        assert_eq!(format_index(9000000), "9000000");
    }

    #[test]
    fn uuid_is_deterministic() {
        assert_eq!(device_uuid("0000001"), device_uuid("0000001"));
        assert_ne!(device_uuid("0000001"), device_uuid("0000002"));
        assert_eq!(device_uuid("0000001").get_version_num(), 5);
    }

    #[test]
    fn allocation_respects_range() {
        assert_eq!(
            allocate(1, 8999999, 3).unwrap(),
            ["0000001", "0000002", "0000003"]
        );
        assert_eq!(
            allocate(9999998, 9999999, 2).unwrap(),
            ["9999998", "9999999"]
        );
        assert!(allocate(9999998, 9999999, 3).is_none());
        assert!(allocate(1, 10, 0).is_none());
    }
}
