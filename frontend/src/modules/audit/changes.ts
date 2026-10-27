import { type Role, roleLabel } from '../../core/domain';
import { formatDateTime } from '../../core/ui/format';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Поля записи журнала одним списком: вложенный объект (например, профиль нового пользователя)
 * раскрывается в отдельные поля, пара «было/стало» остаётся парой.
 */
export function flattenChanges(changes: Record<string, unknown>, hidden: Set<string>): [string, unknown][] {
  return Object.entries(changes)
    .filter(([key]) => !hidden.has(key))
    .flatMap(([key, value]): [string, unknown][] => {
      const nested =
        value && typeof value === 'object' && !Array.isArray(value) && !('old' in value && 'new' in value);
      return nested
        ? Object.entries(value as Record<string, unknown>).filter(([k, v]) => !hidden.has(k) && v !== null)
        : [[key, value]];
    });
}

/** Значения, которые сами по себе непонятны: роли и метки времени. */
export const BUILTIN_VALUE_LABELS: Record<string, (value: string) => string> = {
  role: (v) => roleLabel(v as Role),
};

export function renderValue(value: unknown, label?: (value: string) => string): string {
  if (value && typeof value === 'object' && 'old' in value && 'new' in value) {
    const v = value as { old: unknown; new: unknown };
    return `${renderValue(v.old, label)} → ${renderValue(v.new, label)}`;
  }
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (Array.isArray(value)) return value.map((v) => renderValue(v, label)).join(', ');
  const text = String(value);
  if (label) return label(text);
  return ISO_DATETIME.test(text) ? formatDateTime(text) : text;
}
