import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Plus } from 'lucide-react';
import { useState } from 'react';
import { api, type Pool, type PoolInput } from '../api';
import { type Column, Registry } from '../components/Registry';
import { ErrorBanner, Field, Modal, Segmented } from '../components/ui';
import { useDebounced } from '../hooks';
import { useCan } from '../auth';

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
  const list = useQuery({ queryKey: ['pools', q, archived], queryFn: () => api.pools.list(q, archived) });

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
  const queryClient = useQueryClient();
  const [name, setName] = useState(pool?.name ?? '');
  const [strata, setStrata] = useState([pool?.stratum1 ?? '', pool?.stratum2 ?? '', pool?.stratum3 ?? '']);
  const [allowed, setAllowed] = useState(pool?.allowed ?? true);
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['pools'] });
    queryClient.invalidateQueries({ queryKey: ['workers'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: (input: PoolInput) => (pool ? api.pools.update(pool.id, input) : api.pools.create(input)),
    onSuccess: done,
  });
  const toggleArchive = useMutation({
    mutationFn: () => (pool!.archived ? api.pools.restore(pool!.id) : api.pools.archive(pool!.id)),
    onSuccess: done,
  });

  return (
    <Modal
      title={pool ? pool.name : 'Новый пул'}
      onClose={onClose}
      onSubmit={() => save.mutate({ name, strata, allowed })}
      footer={
        <>
          {pool && (
            <button type="button" className="btn ghost" onClick={() => toggleArchive.mutate()}>
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
