/** Та же логика, что на сервере (R-02 F-01): три числа через любые разделители → «AxBxC». */
export function formatDimensions(raw: string): { value: string | null; error?: string } {
  const text = raw.trim();
  if (!text) return { value: null };
  const bad = [...text].find((c) => !/[0-9\sxXхХ×*,;/-]/.test(c));
  if (bad) return { value: null, error: `Недопустимый символ «${bad}»` };
  const numbers = text
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
  if (numbers.length !== 3 || numbers.some((n) => n <= 0)) {
    return { value: null, error: 'Нужно три числа больше нуля, например 400 195 290' };
  }
  return { value: numbers.join('x') };
}

export const formatDate = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('ru-RU') : '—';

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export const formatNumber = (value: number | null, digits = 0) =>
  value === null ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: digits });

export const today = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
};

/** crypto.randomUUID доступен только в защищённом контексте; по LAN-адресу http его нет. */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Текст CSV с разделителем «;» и BOM — открывается в Excel без настройки. */
export function toCsv(header: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}

/** Скачивание файла по ссылке: сервер отдаёт вложение, страница не меняется. */
export function download(url: string, filename = '') {
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }));
  download(url, filename);
  URL.revokeObjectURL(url);
}

/** INDEX устройства — всегда 7 цифр с ведущими нулями. */
export const formatIndex = (value: number) => String(value).padStart(7, '0');
