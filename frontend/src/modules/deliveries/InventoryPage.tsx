import './styles.css';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DESTINATIONS, destinationLabel } from '../../core/domain';
import { type Column, Registry } from '../../core/ui/Registry';
import { Segmented } from '../../core/ui/ui';
import { useDebounced } from '../../core/ui/useDebounced';
import { exportOptions } from '../reports/exportOptions';
import type { InventoryItem } from './api';
import { useInventory } from './hooks';

const COLUMNS: Column<InventoryItem>[] = [
  { key: 'index', title: 'INDEX', render: (r) => <b className="mono">{r.device_index}</b> },
  {
    key: 'model',
    title: 'Модель',
    render: (r) => (
      <>
        {r.manufacturer} {r.model}
      </>
    ),
  },
  { key: 'mac', title: 'MAC', render: (r) => <span className="mono">{r.mac_address ?? '—'}</span> },
  {
    key: 'serial',
    title: 'Серийный номер',
    render: (r) => <span className="mono small">{r.serial_no ?? '—'}</span>,
  },
  { key: 'client', title: 'Клиент', render: (r) => r.client_name },
  { key: 'delivery', title: 'Поставка', render: (r) => <span className="mono">{r.delivery_number}</span> },
  { key: 'warehouse', title: 'Склад', render: (r) => destinationLabel(r.destination) },
  {
    key: 'location',
    title: 'Место',
    render: (r) =>
      r.location ? <span className="mono">{r.location}</span> : <span className="muted">не размещено</span>,
  },
];

/** Реестр INDEX: поиск устройства по INDEX, MAC, серийному номеру, модели, клиенту, поставке. */
export function InventoryPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [destination, setDestination] = useState('');
  const [placement, setPlacement] = useState('');
  const q = useDebounced(search);
  const inventory = useInventory({ q, destination, placement });
  const rows = inventory.data?.pages.flatMap((p) => p.items);
  const total = inventory.data?.pages[0]?.total ?? 0;

  return (
    <>
      <Registry
        title="Реестр INDEX"
        subtitle="Все устройства из всех поставок: поиск по INDEX, MAC, серийному номеру, модели, клиенту"
        search={search}
        onSearch={setSearch}
        options={exportOptions('inventory')}
        filters={
          <>
            <Segmented
              value={destination}
              onChange={setDestination}
              options={[{ value: '', label: 'Все склады' }, ...DESTINATIONS]}
            />
            <Segmented
              value={placement}
              onChange={setPlacement}
              options={[
                { value: '', label: 'Все' },
                { value: 'placed', label: 'Размещены' },
                { value: 'unplaced', label: 'Не размещены' },
              ]}
            />
          </>
        }
        columns={COLUMNS}
        rows={rows}
        loading={inventory.isPending}
        error={inventory.error}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/inventory/${r.id}`)}
        empty={search ? 'Ничего не найдено' : 'Устройств пока нет — они появляются при создании поставок'}
      />
      {rows && rows.length < total && (
        <div className="load-more">
          <span className="muted small">
            Показано {rows.length} из {total}
          </span>
          <button
            type="button"
            className="btn"
            disabled={inventory.isFetchingNextPage}
            onClick={() => void inventory.fetchNextPage()}
          >
            {inventory.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
          </button>
        </div>
      )}
    </>
  );
}
