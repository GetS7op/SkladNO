import { type ReactNode, useState } from 'react';

/** Столбец таблицы: text — значение для сортировки и выгрузки, render — как показать. */
export type DataColumn<T> = {
  key: string;
  title: string;
  text: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
  align?: 'right';
  /** Скрыт, пока пользователь сам не включит его в «Столбцах». */
  defaultHidden?: boolean;
};

function loadHidden(id: string, columns: DataColumn<unknown>[]): string[] {
  try {
    const saved = localStorage.getItem(`skladno.table.${id}`);
    if (saved) return JSON.parse(saved) as string[];
  } catch {
    // Без хранилища — набор по умолчанию.
  }
  return columns.filter((c) => c.defaultHidden).map((c) => c.key);
}

/**
 * Какие столбцы видны: выбор запоминается в браузере отдельно для каждой таблицы.
 * Вынесено из таблицы, чтобы страница выгружала CSV ровно с видимыми столбцами.
 */
export function useTableColumns<T>(id: string, columns: DataColumn<T>[]) {
  const [hidden, setHidden] = useState(() => loadHidden(id, columns as DataColumn<unknown>[]));
  const save = (next: string[]) => {
    setHidden(next);
    try {
      localStorage.setItem(`skladno.table.${id}`, JSON.stringify(next));
    } catch {
      // Выбор просто не запомнится.
    }
  };
  return {
    columns,
    visible: columns.filter((c) => !hidden.includes(c.key)),
    isHidden: (key: string) => hidden.includes(key),
    toggle: (key: string) => save(hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]),
    reset: () => save(columns.filter((c) => c.defaultHidden).map((c) => c.key)),
  };
}

export type TableColumns<T> = ReturnType<typeof useTableColumns<T>>;
