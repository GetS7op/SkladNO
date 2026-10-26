import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type DeliverySummary } from '../api';
import { exportOptions } from '../components/ExportImport';
import { type Column, Registry } from '../components/Registry';
import { STAGES, destinationLabel, formatDate } from '../format';
import { useDebounced } from '../hooks';
import { StageBadge } from './StageBadge';

const COLUMNS: Column<DeliverySummary>[] = [
  { key: 'number', title: 'Наименование', render: (r) => <b className="mono">{r.number}</b> },
  { key: 'date', title: 'Дата', render: (r) => formatDate(r.delivery_date) },
  { key: 'client', title: 'Клиент', render: (r) => r.client_name },
  { key: 'group', title: 'Группа устройств', render: (r) => r.device_group ?? '—' },
  { key: 'basis', title: 'Документ-основание', render: (r) => r.basis_doc ?? '—' },
  { key: 'dest', title: 'Назначение', render: (r) => destinationLabel(r.destination) },
  { key: 'devices', title: 'Устройств', align: 'right', render: (r) => r.devices },
  { key: 'stage', title: 'Состояние', render: (r) => <StageBadge stage={r.stage} /> },
];

/** F-03. Реестр поставок. */
export function DeliveriesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const q = useDebounced(search);
  const list = useQuery({ queryKey: ['deliveries', q, stage], queryFn: () => api.deliveries.list(q, stage) });

  return (
    <Registry
      title="Поставки"
      subtitle="Поступление партий устройств и присвоение Index"
      search={search}
      onSearch={setSearch}
      options={[
        { label: 'Новая поставка', icon: <Plus size={16} />, onClick: () => navigate('/deliveries/new') },
        ...exportOptions('deliveries'),
      ]}
      filters={
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Состояние">
          <option value="">Все состояния</option>
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      }
      columns={COLUMNS}
      rows={list.data}
      loading={list.isPending}
      error={list.error}
      rowKey={(r) => r.id}
      onRowClick={(r) => navigate(`/deliveries/${r.id}`)}
      empty="Поставок пока нет — создайте через ~option"
    />
  );
}
