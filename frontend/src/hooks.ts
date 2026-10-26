import { useEffect, useState } from 'react';

/** Поиск уходит на сервер с задержкой, чтобы не дёргать API на каждый символ. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
