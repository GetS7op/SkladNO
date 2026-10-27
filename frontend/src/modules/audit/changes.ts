import { type Role, roleLabel } from '../../core/domain';
import { formatDate, formatDateTime } from '../../core/ui/format';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Поля записи журнала одним списком: вложенный объект (например, профиль нового пользователя)
 * раскрывается в отдельные поля, пара «было/стало» остаётся парой.
 */
export function flattenChanges(changes: Record<string, unknown>, hidden: Set<string>): [string, unknown][] {
  return (
    Object.entries(changes)
      // Пустые поля в записи о создании ничего не говорят — их не показываем.
      .filter(([key, value]) => !hidden.has(key) && value !== null)
      .flatMap(([key, value]): [string, unknown][] => {
        const nested =
          value && typeof value === 'object' && !Array.isArray(value) && !('old' in value && 'new' in value);
        return nested
          ? Object.entries(value as Record<string, unknown>).filter(([k, v]) => !hidden.has(k) && v !== null)
          : [[key, value]];
      })
  );
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
  if (ISO_DATETIME.test(text)) return formatDateTime(text);
  return ISO_DATE.test(text) ? formatDate(text) : text;
}
