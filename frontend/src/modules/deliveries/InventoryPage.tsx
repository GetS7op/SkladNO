import './styles.css';
import { Download, HelpCircle, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { stageLabel } from '../../core/domain';
import { ColumnPicker, DataTable } from '../../core/ui/DataTable';
import { type DataColumn, useTableColumns } from '../../core/ui/tableColumns';
import { downloadCsv, formatNumber } from '../../core/ui/format';
import { ErrorBanner, Segmented } from '../../core/ui/ui';
import { useDebounced } from '../../core/ui/useDebounced';
import { useWarehouseOptions } from '../locations/hooks';
import type { InventoryItem } from './api';
import { useInventory, useInventoryStats } from './hooks';

/** Дата поставки коротко, как в mf-old: «12.25». */
const monthYear = (date: string) => `${date.slice(5, 7)}.${date.slice(2, 4)}`;

const deviceLabel = (r: InventoryItem) =>
  [r.manufacturer, r.model, r.hashrate_ths !== null ? `${formatNumber(r.hashrate_ths)} Th` : null]
    .filter(Boolean)
    .join(' · ');

const COLUMNS: DataColumn<InventoryItem>[] = [
  {
    key: 'index',
    title: 'INDEX',
    text: (r) => r.device_index,
    render: (r) => <b className="mono">{r.device_index}</b>,
  },
  { key: 'device', title: 'Устройство', text: deviceLabel },
  { key: 'stage', title: 'Этап поставки', text: (r) => stageLabel(r.stage) },
  {
    key: 'mac',
    title: 'MAC-адрес',
    text: (r) => r.mac_address,
    render: (r) => <span className="mono">{r.mac_address ?? '—'}</span>,
  },
  {
    key: 'serial',
    title: 'Серийный №',
    text: (r) => r.serial_no,
    render: (r) => <span className="mono small">{r.serial_no ?? '—'}</span>,
  },
  { key: 'client', title: 'Клиент', text: (r) => r.client_name },
  {
    key: 'date',
    title: 'Дата поставки',
    text: (r) => r.delivery_date,
    render: (r) => monthYear(r.delivery_date),
  },
  { key: 'warehouse', title: 'Склад', text: (r) => r.destination_name },
  {
    key: 'location',
    title: 'Местоположение',
    text: (r) => r.location,
    render: (r) =>
      r.location ? <span className="mono">{r.location}</span> : <span className="muted">не размещено</span>,
  },
  { key: 'manufacturer', title: 'Производитель', text: (r) => r.manufacturer, defaultHidden: true },
  { key: 'model', title: 'Модель', text: (r) => r.model, defaultHidden: true },
  { key: 'xp', title: 'XP, Th/s', text: (r) => r.hashrate_ths, align: 'right', defaultHidden: true },
  { key: 'power', title: 'Потребление, Вт', text: (r) => r.power_w, align: 'right', defaultHidden: true },
  { key: 'delivery', title: 'Поставка', text: (r) => r.delivery_number, defaultHidden: true },
];

const SEARCH_PLACEHOLDER = '0000001-0000004 0000005 · M60S+ · AA:BB:CC:DD:EE:FF';

/**
 * Главная — реестр INDEX в духе склада mf-old: плитки, поиск по нескольким критериям сразу,
 * таблица всех найденных устройств с выбором столбцов и выгрузкой CSV.
 * Поиск и фильтры живут в адресе страницы: перезагрузка их сохраняет.
 */
export function InventoryPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [helpOpen, setHelpOpen] = useState(false);
  const exact = params.get('x') === '1';
  const destination = params.get('wh') ?? '';
  const placement = params.get('pl') ?? '';
  const q = useDebounced(search);
  const warehouses = useWarehouseOptions();
  const table = useTableColumns('inventory', COLUMNS);
  const inventory = useInventory({ q, exact, destination, placement });
  const stats = useInventoryStats(destination);
  const rows = inventory.data?.items ?? [];

  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const onSearch = (value: string) => {
    setSearch(value);
    setParam('q', value);
  };
  const exportCsv = () =>
    downloadCsv(
      'skladno-inventory.csv',
      table.visible.map((c) => c.title),
      rows.map((r) => table.visible.map((c) => c.text(r))),
    );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Главная</h1>
          <p className="muted">
            Реестр INDEX — все устройства из всех поставок: INDEX, MAC, серийный номер, клиент и место
          </p>
        </div>
      </header>

      <div className="tiles">
        <Tile label="Устройств" value={stats.data?.devices} />
        <Tile label="Клиентов" value={stats.data?.clients} />
        <Tile label="Позиций устройств" value={stats.data?.models} />
        <Tile label="С MAC-адресом" value={stats.data?.with_mac} />
      </div>

      <div className="inventory-filters">
        <Segmented
          value={destination}
          onChange={(v) => setParam('wh', v)}
          options={[{ value: '', label: 'Все склады' }, ...warehouses]}
        />
        <Segmented
          value={placement}
          onChange={(v) => setParam('pl', v)}
          options={[
            { value: '', label: 'Все' },
            { value: 'placed', label: 'Размещены' },
            { value: 'unplaced', label: 'Не размещены' },
          ]}
        />
      </div>

      <div className="inventory-search">
        <label className="search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={SEARCH_PLACEHOLDER}
            aria-label="Поиск устройств"
          />
        </label>
        <button
          type="button"
          className="btn ghost"
          aria-expanded={helpOpen}
          aria-label="Как искать"
          title="Как искать"
          onClick={() => setHelpOpen(!helpOpen)}
        >
          <HelpCircle size={16} />
        </button>
        <label className="check" title="Все критерии должны выполниться на одном устройстве">
          <input
            type="checkbox"
            checked={exact}
            onChange={(e) => setParam('x', e.target.checked ? '1' : '')}
          />
          Точное совпадение
        </label>
        <span className="spacer" />
        <ColumnPicker table={table} />
        <button type="button" className="btn" disabled={rows.length === 0} onClick={exportCsv}>
          <Download size={16} /> Выгрузить CSV
        </button>
      </div>

      {helpOpen && (
        <div className="search-help muted small">
          Критерии разделяются запятой, точкой с запятой, пробелом или переносом строки — можно смешивать:
          <ul>
            <li>число — INDEX: 5 и 0000005 одно и то же;</li>
            <li>1-4 или 0000001-4 — диапазон INDEX, ведущие нули не важны;</li>
            <li>AA:BB:CC:DD:EE:FF, aabbccddeeff, AA-BB-CC-DD-EE-FF — MAC в любом написании;</li>
            <li>остальное — текстом: модель, серийный номер, клиент, номер поставки, группа устройств.</li>
          </ul>
          Критерии соединяются через «или». С «Точным совпадением» — через «и»: одно устройство должно подойти
          под все критерии сразу.
        </div>
      )}

      <ErrorBanner error={inventory.error} />
      <p className="muted small found">
        Найдено записей: <b>{inventory.data?.total.toLocaleString('ru-RU') ?? '…'}</b>
        {inventory.data?.summary && ` — ${inventory.data.summary}`}
        {inventory.isFetching && ' · обновление…'}
      </p>
      {inventory.data && rows.length === 0 ? (
        <p className="empty-state">
          {search ? 'Ничего не найдено' : 'Устройств пока нет — они появляются при создании поставок'}
        </p>
      ) : (
        <DataTable
          table={table}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/inventory/${r.id}`)}
        />
      )}
      <p className="muted small">
        Все найденные записи в одной таблице · клик по заголовку — сортировка · клик по строке — карточка
        устройства
      </p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value?: number }) {
  return (
    <div className="tile">
      <span>{label}</span>
      <b>{value === undefined ? '…' : value.toLocaleString('ru-RU')}</b>
    </div>
  );
}
