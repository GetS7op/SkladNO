import { Archive, ArchiveRestore, ExternalLink, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCan } from '../../core/auth/context';
import { type Column, Registry } from '../../core/ui/Registry';
import { ErrorBanner, Field, Modal, Segmented } from '../../core/ui/ui';
import { useDebounced } from '../../core/ui/useDebounced';
import { exportOptions } from '../reports/exportOptions';
import type { Worker, WorkerInput } from './api';
import {
  useCreateWorker,
  usePools,
  useSetWorkerArchived,
  useUpdateWorker,
  useWorkerGroups,
  useWorkers,
} from './hooks';

const ONLINE_PENDING = 'Появится с подключением к API пулов';

const COLUMNS: Column<Worker>[] = [
  { key: 'pool', title: 'Пул', group: 'offline', render: (r) => r.pool_name },
  { key: 'name', title: 'Воркер', group: 'offline', render: (r) => <b className="mono">{r.name}</b> },
  { key: 'group', title: 'Группа', group: 'offline', render: (r) => r.group_name ?? '—' },
  {
    key: 'watcher',
    title: 'Вотчерлинк',
    group: 'offline',
    render: (r) =>
      r.watcher_url ? (
        <a href={r.watcher_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          <ExternalLink size={14} /> открыть
        </a>
      ) : (
        '—'
      ),
  },
  {
    key: 'online',
    title: 'Онлайн',
    group: 'online',
    render: () => (
      <span className="muted" title={ONLINE_PENDING}>
        —
      </span>
    ),
  },
  {
    key: 'xp',
    title: 'XP',
    group: 'online',
    align: 'right',
    render: () => (
      <span className="muted" title={ONLINE_PENDING}>
        —
      </span>
    ),
  },
];

/** F-05. Вайтлист воркеров. */
export function WorkersPage() {
  const canEdit = useCan('senior');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'active' | 'archive'>('active');
  const [editing, setEditing] = useState<Worker | 'new' | null>(null);
  const q = useDebounced(search);
  const archived = view === 'archive';
  const list = useWorkers({ q, archived });

  return (
    <>
      <Registry
        title="Вайтлист воркеров"
        subtitle="Воркеры по пулам и группам для онлайн-проверки"
        search={search}
        onSearch={setSearch}
        options={[
          {
            label: 'Новый воркер',
            hidden: !canEdit,
            icon: <Plus size={16} />,
            onClick: () => setEditing('new'),
          },
          ...exportOptions('workers'),
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
        empty={archived ? 'В архиве пусто' : 'Воркеров пока нет — добавьте через ~option'}
      />
      {editing && <WorkerForm worker={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function WorkerForm({ worker, onClose }: { worker: Worker | null; onClose: () => void }) {
  const [form, setForm] = useState({
    pool_id: worker?.pool_id ?? '',
    name: worker?.name ?? '',
    group_name: worker?.group_name ?? '',
    watcher_url: worker?.watcher_url ?? '',
  });
  const pools = usePools({ q: '', archived: false });
  const groups = useWorkerGroups();
  const create = useCreateWorker();
  const update = useUpdateWorker();
  const toggleArchive = useSetWorkerArchived();
  const save = worker ? update : create;
  const submit = (input: WorkerInput) =>
    worker
      ? update.mutate({ id: worker.id, input }, { onSuccess: onClose })
      : create.mutate(input, { onSuccess: onClose });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Modal
      title={worker ? worker.name : 'Новый воркер'}
      onClose={onClose}
      onSubmit={() =>
        submit({
          pool_id: form.pool_id,
          name: form.name,
          group_name: form.group_name || null,
          watcher_url: form.watcher_url || null,
        })
      }
      footer={
        <>
          {worker && (
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                toggleArchive.mutate({ id: worker.id, archived: !worker.archived }, { onSuccess: onClose })
              }
            >
              {worker.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              {worker.archived ? 'Вернуть из архива' : 'В архив'}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={save.isPending}>
            Сохранить
          </button>
        </>
      }
    >
      <ErrorBanner error={save.error ?? toggleArchive.error} />
      <Field label="Пул" required>
        <select value={form.pool_id} onChange={set('pool_id')} required autoFocus>
          <option value="">— выберите пул —</option>
          {pools.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {pools.data?.length === 0 && (
        <p className="muted small">
          Вайтлист пулов пуст — <Link to="/pools">добавьте пул</Link>.
        </p>
      )}
      <Field label="Воркер" required hint="Уникален в рамках пула">
        <input className="mono" value={form.name} onChange={set('name')} required />
      </Field>
      <Field label="Группа" hint="Выберите или введите новую">
        <input value={form.group_name} onChange={set('group_name')} list="worker-groups" />
        <datalist id="worker-groups">
          {groups.data?.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </Field>
      <Field label="Вотчерлинк">
        <input value={form.watcher_url} onChange={set('watcher_url')} type="url" placeholder="https://" />
      </Field>
    </Modal>
  );
}
