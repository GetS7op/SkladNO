import { ChevronDown, Search } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface Column<T> {
  key: string;
  title: string;
  /** D-04: колонки делятся на «Оффлайн ф-кции» и «Онлайн ф-кции». */
  group?: 'offline' | 'online';
  align?: 'right';
  render: (row: T) => ReactNode;
}

export interface OptionItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Пункт скрыт, если у роли нет права на действие. */
  hidden?: boolean;
}

interface RegistryProps<T> {
  title: string;
  subtitle?: string;
  search: string;
  onSearch: (value: string) => void;
  options: OptionItem[];
  filters?: ReactNode;
  columns: Column<T>[];
  rows: T[] | undefined;
  loading: boolean;
  error: Error | null;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty: string;
}

const GROUP_TITLES = { offline: 'Оффлайн ф-кции', online: 'Онлайн ф-кции' };

/** D-03: единый вид реестра — поиск, кнопка «~option», фильтры, таблица. */
export function Registry<T>(props: RegistryProps<T>) {
  const { columns, rows } = props;
  const grouped = columns.some((c) => c.group);
  const groups = grouped ? groupSpans(columns) : [];

  return (
    <section className="registry">
      <header className="page-head">
        <div>
          <h1>{props.title}</h1>
          {props.subtitle && <p className="muted">{props.subtitle}</p>}
        </div>
      </header>
      <div className="registry-toolbar">
        <label className="search">
          <Search size={16} />
          <input
            value={props.search}
            onChange={(e) => props.onSearch(e.target.value)}
            placeholder="Поиск"
            aria-label="Поиск"
          />
        </label>
        {props.options.some((o) => !o.hidden) && (
          <OptionMenu items={props.options.filter((o) => !o.hidden)} />
        )}
        {props.filters && <div className="filters">{props.filters}</div>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            {grouped && (
              <tr className="group-row">
                {groups.map((g, i) => (
                  <th key={i} colSpan={g.span} className={g.group ? `group-${g.group}` : ''}>
                    {g.group ? GROUP_TITLES[g.group] : ''}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.loading && (
              <tr>
                <td colSpan={columns.length} className="table-note">
                  Загрузка…
                </td>
              </tr>
            )}
            {props.error && (
              <tr>
                <td colSpan={columns.length} className="table-note error">
                  {props.error.message}
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="table-note">
                  {props.empty}
                </td>
              </tr>
            )}
            {rows?.map((row) => (
              <tr
                key={props.rowKey(row)}
                className={props.onRowClick ? 'clickable' : undefined}
                onClick={props.onRowClick ? () => props.onRowClick!(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows && rows.length > 0 && <p className="muted count">Записей: {rows.length}</p>}
    </section>
  );
}

function groupSpans<T>(columns: Column<T>[]) {
  const spans: { group?: 'offline' | 'online'; span: number }[] = [];
  for (const c of columns) {
    const last = spans.at(-1);
    if (last && last.group === c.group) last.span += 1;
    else spans.push({ group: c.group, span: 1 });
  }
  return spans;
}

function OptionMenu({ items }: { items: OptionItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="option-menu" ref={ref}>
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        ~option <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
