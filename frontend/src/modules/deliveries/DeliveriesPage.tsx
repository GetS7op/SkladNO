import './styles.css';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STAGES, conditionLabel, destinationLabel } from '../../core/domain';
import { formatDate } from '../../core/ui/format';
import { type Column, Registry } from '../../core/ui/Registry';
import { useDebounced } from '../../core/ui/useDebounced';
import { exportOptions } from '../reports/exportOptions';
import type { DeliverySummary } from './api';
import { useDeliveries } from './hooks';
import { StageBadge } from './StageBadge';

const COLUMNS: Column<DeliverySummary>[] = [
  { key: 'number', title: 'Наименование', render: (r) => <b className="mono">{r.number}</b> },
  { key: 'date', title: 'Дата', render: (r) => formatDate(r.delivery_date) },
  { key: 'client', title: 'Клиент', render: (r) => r.client_name },
  { key: 'group', title: 'Группа устройств', render: (r) => r.device_group ?? '—' },
  { key: 'basis', title: 'Документ-основание', render: (r) => r.basis_doc ?? '—' },
  { key: 'dest', title: 'Назначение', render: (r) => destinationLabel(r.destination) },
  { key: 'devices', title: 'Устройств', align: 'right', render: (r) => r.devices },
  {
    key: 'condition',
    title: 'Состояние',
    render: (r) => (
      <span className={r.condition ? undefined : 'muted'}>
        {conditionLabel(r.condition)}
        {r.customs && <span className="badge yes customs">таможенные</span>}
      </span>
    ),
  },
  { key: 'stage', title: 'Этап', render: (r) => <StageBadge stage={r.stage} /> },
];

/** F-03. Реестр поставок. */
export function DeliveriesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const q = useDebounced(search);
  const list = useDeliveries({ q, stage });

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
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Этап">
          <option value="">Все этапы</option>
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
