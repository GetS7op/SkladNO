//! Защита входа от подбора пароля: после серии неудачных попыток логин временно блокируется.
//! Счётчики в памяти процесса — при перезапуске сбрасываются, для одного сервера этого достаточно.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

/// Сколько неудачных попыток подряд допускается в пределах окна.
pub const MAX_FAILURES: u32 = 10;
/// Окно подсчёта и срок блокировки.
pub const WINDOW: Duration = Duration::from_secs(15 * 60);

/// Общий счётчик процесса: вход его пополняет, сброс пароля администратором снимает блокировку.
pub static LOGIN_THROTTLE: std::sync::LazyLock<LoginThrottle> =
    std::sync::LazyLock::new(LoginThrottle::default);

#[derive(Default)]
pub struct LoginThrottle {
    failures: Mutex<HashMap<String, (u32, Instant)>>,
}

impl LoginThrottle {
    /// Сколько ещё ждать, если логин заблокирован.
    pub fn blocked_for(&self, login: &str, now: Instant) -> Option<Duration> {
        let failures = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        let (count, since) = failures.get(&key(login))?;
        let elapsed = now.duration_since(*since);
        (*count >= MAX_FAILURES && elapsed < WINDOW).then(|| WINDOW - elapsed)
    }

    pub fn record_failure(&self, login: &str, now: Instant) {
        let mut failures = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        // Старые записи убираем, чтобы перебор разных логинов не раздувал память.
        failures.retain(|_, (_, since)| now.duration_since(*since) < WINDOW);
        let entry = failures.entry(key(login)).or_insert((0, now));
        entry.0 += 1;
    }

    pub fn reset(&self, login: &str) {
        self.failures
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&key(login));
    }
}

fn key(login: &str) -> String {
    login.trim().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_after_failures_and_expires() {
        let throttle = LoginThrottle::default();
        let start = Instant::now();
        for _ in 0..MAX_FAILURES - 1 {
            throttle.record_failure("Admin", start);
        }
        assert!(throttle.blocked_for("admin", start).is_none());
        throttle.record_failure(" admin ", start);
        assert!(
            throttle
                .blocked_for("ADMIN", start + Duration::from_secs(60))
                .is_some()
        );
        assert!(throttle.blocked_for("admin", start + WINDOW).is_none());
        assert!(throttle.blocked_for("other", start).is_none());
    }

    #[test]
    fn success_resets() {
        let throttle = LoginThrottle::default();
        let start = Instant::now();
        for _ in 0..MAX_FAILURES {
            throttle.record_failure("admin", start);
        }
        throttle.reset("admin");
        assert!(throttle.blocked_for("admin", start).is_none());
    }
}
