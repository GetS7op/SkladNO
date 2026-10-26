import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type AuditEntry, type Destination, type Stage } from '../api';
import { Segmented } from '../components/ui';
import { destinationLabel, formatDateTime, stageLabel } from '../format';

const ENTITY_LABELS: Record<string, string> = {
  device_model: 'Модель устройства',
  client: 'Клиент',
  delivery: 'Поставка',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'создание',
  update: 'изменение',
  archive: 'в архив',
  restore: 'из архива',
  advance: 'смена этапа',
};

const FIELD_LABELS: Record<string, string> = {
  manufacturer: 'Производитель',
  model: 'Модель',
  hashrate_ths: 'XP',
  power_w: 'Потребление',
  dimensions_mm: 'Размеры',
  weight_kg: 'Вес',
  archived: 'Архив',
  name: 'Наименование',
  note: 'Заметка',
  stage: 'Этап',
  number: 'Номер',
  devices: 'Устройств',
  destination: 'Назначение',
  index_from: 'Index с',
  index_to: 'Index по',
};

const HIDDEN = new Set(['id', 'client_id']);

/** Журнал действий: когда, кто и что сделал; для изменений — старое и новое значение. */
export function AuditPage() {
  const [entity, setEntity] = useState('');
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Журнал действий</h1>
          <p className="muted">Последние 300 записей</p>
        </div>
      </header>
      <div className="registry-toolbar">
        <Segmented
          value={entity}
          onChange={setEntity}
          options={[
            { value: '', label: 'Все' },
            { value: 'delivery', label: 'Поставки' },
            { value: 'device_model', label: 'Устройства' },
            { value: 'client', label: 'Клиенты' },
          ]}
        />
      </div>
      <div className="card">
        <AuditList entity={entity || undefined} />
      </div>
    </section>
  );
}

export function AuditList({
  entity,
  entityId,
  compact,
}: {
  entity?: string;
  entityId?: string;
  compact?: boolean;
}) {
  const list = useQuery({
    queryKey: ['audit', entity, entityId],
    queryFn: () => api.audit.list(entity, entityId),
  });
  if (list.isPending) return <p className="muted">Загрузка…</p>;
  if (list.error) return <p className="error">{list.error.message}</p>;
  if (list.data.length === 0) return <p className="muted">Записей нет</p>;
  return (
    <ul className="audit">
      {list.data.map((e) => (
        <li key={e.id}>
          <time>{formatDateTime(e.at)}</time>
          <span className="who">{e.actor === 'system' ? 'система' : e.actor}</span>
          <span>
            {!compact && <b>{ENTITY_LABELS[e.entity] ?? e.entity}</b>} {ACTION_LABELS[e.action] ?? e.action}
            <Changes entry={e} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Changes({ entry }: { entry: AuditEntry }) {
  const items = Object.entries(entry.changes ?? {}).filter(([k]) => !HIDDEN.has(k));
  if (items.length === 0) return null;
  return (
    <span className="changes">
      {items.map(([key, value]) => (
        <span key={key}>
          {FIELD_LABELS[key] ?? key}: {renderValue(value, VALUE_LABELS[key])}
        </span>
      ))}
    </span>
  );
}

const VALUE_LABELS: Record<string, (value: string) => string> = {
  stage: (v) => stageLabel(v as Stage),
  destination: (v) => destinationLabel(v as Destination),
};

function renderValue(value: unknown, label?: (value: string) => string): string {
  if (value && typeof value === 'object' && 'old' in value && 'new' in value) {
    const v = value as { old: unknown; new: unknown };
    return `${renderValue(v.old, label)} → ${renderValue(v.new, label)}`;
  }
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  return label ? label(String(value)) : String(value);
}
