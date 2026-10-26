import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ExternalLink, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Worker, type WorkerInput } from '../api';
import { type Column, Registry } from '../components/Registry';
import { ErrorBanner, Field, Modal, Segmented } from '../components/ui';
import { useDebounced } from '../hooks';
import { useCan } from '../auth';

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
  const list = useQuery({ queryKey: ['workers', q, archived], queryFn: () => api.workers.list(q, archived) });

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
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    pool_id: worker?.pool_id ?? '',
    name: worker?.name ?? '',
    group_name: worker?.group_name ?? '',
    watcher_url: worker?.watcher_url ?? '',
  });
  const pools = useQuery({ queryKey: ['pools', '', false], queryFn: () => api.pools.list('', false) });
  const groups = useQuery({ queryKey: ['worker-groups'], queryFn: api.workers.groups });
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['workers'] });
    queryClient.invalidateQueries({ queryKey: ['worker-groups'] });
    queryClient.invalidateQueries({ queryKey: ['pools'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: (input: WorkerInput) =>
      worker ? api.workers.update(worker.id, input) : api.workers.create(input),
    onSuccess: done,
  });
  const toggleArchive = useMutation({
    mutationFn: () => (worker!.archived ? api.workers.restore(worker!.id) : api.workers.archive(worker!.id)),
    onSuccess: done,
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Modal
      title={worker ? worker.name : 'Новый воркер'}
      onClose={onClose}
      onSubmit={() =>
        save.mutate({
          pool_id: form.pool_id,
          name: form.name,
          group_name: form.group_name || null,
          watcher_url: form.watcher_url || null,
        })
      }
      footer={
        <>
          {worker && (
            <button type="button" className="btn ghost" onClick={() => toggleArchive.mutate()}>
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
