import { ArrowDown, ArrowUp, Columns3 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { TableColumns } from './tableColumns';

const ROW_HEIGHT = 37;
/** Сколько строк рисовать сверх видимых, чтобы прокрутка шла без пустых мест. */
const OVERSCAN = 12;
const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

/** Кнопка «Столбцы»: показать, скрыть, вернуть набор по умолчанию. */
export function ColumnPicker<T>({ table }: { table: TableColumns<T> }) {
  return (
    <details className="column-picker">
      <summary className="btn">
        <Columns3 size={16} /> Столбцы
      </summary>
      <div className="column-menu">
        {table.columns.map((c) => (
          <label key={c.key}>
            <input type="checkbox" checked={!table.isHidden(c.key)} onChange={() => table.toggle(c.key)} />
            {c.title}
          </label>
        ))}
        <p className="muted small">
          Отображается {table.visible.length} из {table.columns.length}
        </p>
        <button type="button" className="btn ghost" onClick={table.reset}>
          Сбросить
        </button>
      </div>
    </details>
  );
}

/**
 * Все строки в одной прокручиваемой таблице, как в mf-old: без постраничного вывода.
 * Рисуются только видимые строки, поэтому тысячи устройств не тормозят страницу.
 */
export function DataTable<T>({
  table,
  rows,
  rowKey,
  onRowClick,
  height = 560,
}: {
  table: TableColumns<T>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  height?: number;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const columns = table.visible;

  const sorted = useMemo(() => {
    const column = sort && columns.find((c) => c.key === sort.key);
    if (!column || !sort) return rows;
    return [...rows].sort((a, b) => {
      const av = column.text(a);
      const bv = column.text(b);
      const n =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : collator.compare(String(av ?? ''), String(bv ?? ''));
      return sort.desc ? -n : n;
    });
  }, [rows, sort, columns]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(sorted.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, desc: false } : s.desc ? null : { key, desc: true }));

  if (columns.length === 0) {
    return <p className="empty-state">Все столбцы скрыты — выберите их в «Столбцах».</p>;
  }
  return (
    <div
      ref={scroller}
      className="table-wrap data-table"
      style={{ maxHeight: height }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                <button type="button" className="sort-button" onClick={() => toggleSort(c.key)}>
                  {c.title}
                  {sort?.key === c.key && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {first > 0 && <tr style={{ height: first * ROW_HEIGHT }} aria-hidden />}
          {sorted.slice(first, last).map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                  {c.render ? c.render(row) : (c.text(row) ?? '—')}
                </td>
              ))}
            </tr>
          ))}
          {last < sorted.length && <tr style={{ height: (sorted.length - last) * ROW_HEIGHT }} aria-hidden />}
        </tbody>
      </table>
    </div>
  );
}
