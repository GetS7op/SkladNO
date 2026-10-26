import { Archive, ArchiveRestore, Plus } from 'lucide-react';
import { useState } from 'react';
import { useCan } from '../../core/auth/context';
import { type Column, Registry } from '../../core/ui/Registry';
import { ErrorBanner, Field, Modal, Segmented } from '../../core/ui/ui';
import { useDebounced } from '../../core/ui/useDebounced';
import { exportOptions } from '../reports/exportOptions';
import type { Pool, PoolInput } from './api';
import { useCreatePool, usePools, useSetPoolArchived, useUpdatePool } from './hooks';

const COLUMNS: Column<Pool>[] = [
  { key: 'name', title: 'Наименование пула', render: (r) => <b>{r.name}</b> },
  {
    key: 'strata',
    title: 'Стратум-линки',
    render: (r) => (
      <span className="stack mono small">
        {[r.stratum1, r.stratum2, r.stratum3].filter(Boolean).map((s) => (
          <span key={s}>{s}</span>
        ))}
      </span>
    ),
  },
  {
    key: 'allowed',
    title: 'Разрешение',
    render: (r) => <span className={`badge ${r.allowed ? 'yes' : 'no'}`}>{r.allowed ? 'Да' : 'Нет'}</span>,
  },
  { key: 'workers', title: 'Воркеров', align: 'right', render: (r) => r.workers },
];

/** F-04. Вайтлист пулов. */
export function PoolsPage() {
  const canEdit = useCan('senior');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'active' | 'archive'>('active');
  const [editing, setEditing] = useState<Pool | 'new' | null>(null);
  const q = useDebounced(search);
  const archived = view === 'archive';
  const list = usePools({ q, archived });

  return (
    <>
      <Registry
        title="Вайтлист пулов"
        subtitle="Пулы и стратум-линки для шаблонов настроек"
        search={search}
        onSearch={setSearch}
        options={[
          {
            label: 'Новый пул',
            hidden: !canEdit,
            icon: <Plus size={16} />,
            onClick: () => setEditing('new'),
          },
          ...exportOptions('pools'),
        ]}
        filters={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'active', label: 'Активные' },
              { value: 'archive', label: 'Архив' },
            ]}
          />
        }
        columns={COLUMNS}
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        onRowClick={setEditing}
        empty={archived ? 'В архиве пусто' : 'Пулов пока нет — добавьте через ~option'}
      />
      {editing && <PoolForm pool={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PoolForm({ pool, onClose }: { pool: Pool | null; onClose: () => void }) {
  const [name, setName] = useState(pool?.name ?? '');
  const [strata, setStrata] = useState([pool?.stratum1 ?? '', pool?.stratum2 ?? '', pool?.stratum3 ?? '']);
  const [allowed, setAllowed] = useState(pool?.allowed ?? true);
  const create = useCreatePool();
  const update = useUpdatePool();
  const toggleArchive = useSetPoolArchived();
  const save = pool ? update : create;
  const submit = (input: PoolInput) =>
    pool
      ? update.mutate({ id: pool.id, input }, { onSuccess: onClose })
      : create.mutate(input, { onSuccess: onClose });

  return (
    <Modal
      title={pool ? pool.name : 'Новый пул'}
      onClose={onClose}
      onSubmit={() => submit({ name, strata, allowed })}
      footer={
        <>
          {pool && (
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                toggleArchive.mutate({ id: pool.id, archived: !pool.archived }, { onSuccess: onClose })
              }
            >
              {pool.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              {pool.archived ? 'Вернуть из архива' : 'В архив'}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            type="submit"
            className="btn primary"
            disabled={save.isPending || !strata.some((s) => s.trim())}
          >
            Сохранить
          </button>
        </>
      }
    >
      <ErrorBanner error={save.error ?? toggleArchive.error} />
      <Field label="Наименование пула" required>
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      {strata.map((value, i) => (
        <Field key={i} label={`Стратум-линк ${i + 1}`} required={i === 0}>
          <input
            className="mono"
            value={value}
            onChange={(e) => setStrata((s) => s.map((v, j) => (j === i ? e.target.value : v)))}
            placeholder="stratum+tcp://pool.example:3333"
          />
        </Field>
      ))}
      <label className="check">
        <input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />
        Разрешение: пул разрешён к использованию
      </label>
      <p className="muted small">Формат ссылок не проверяется. Удаление пулов запрещено — только архив.</p>
    </Modal>
  );
}
