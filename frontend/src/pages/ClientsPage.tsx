import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import { useState } from 'react';
import { api, type Client, type ClientInput } from '../api';
import { type Column, Registry } from '../components/Registry';
import { ErrorBanner, Field, Modal } from '../components/ui';
import { downloadCsv } from '../format';
import { useDebounced } from '../hooks';

const ONLINE_PENDING = 'Появится вместе с вайтлистом воркеров (F-05)';

const COLUMNS: Column<Client>[] = [
  { key: 'name', title: 'Наименование', group: 'offline', render: (r) => <b>{r.name}</b> },
  { key: 'note', title: 'Заметка', group: 'offline', render: (r) => r.note ?? '' },
  { key: 'deliveries', title: 'Поставок', group: 'offline', align: 'right', render: (r) => r.deliveries },
  { key: 'devices', title: 'Устройств', group: 'offline', align: 'right', render: (r) => r.devices },
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
  {
    key: 'online',
    title: 'Онлайн',
    group: 'online',
    align: 'right',
    render: () => (
      <span className="muted" title={ONLINE_PENDING}>
        —
      </span>
    ),
  },
];

/** F-02. Клиенты: без удаления и архива, только редактирование. */
export function ClientsPage() {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const q = useDebounced(search);
  const list = useQuery({ queryKey: ['clients', q], queryFn: () => api.clients.list(q) });

  return (
    <>
      <Registry
        title="Клиенты"
        subtitle="Сводка по поставкам и устройствам каждого клиента"
        search={search}
        onSearch={setSearch}
        options={[
          { label: 'Новый клиент', icon: <Plus size={16} />, onClick: () => setEditing('new') },
          {
            label: 'Экспорт CSV',
            icon: <Download size={16} />,
            onClick: () =>
              downloadCsv(
                'clients.csv',
                ['Наименование', 'Заметка', 'Поставок', 'Устройств'],
                (list.data ?? []).map((r) => [r.name, r.note, r.deliveries, r.devices]),
              ),
          },
        ]}
        columns={COLUMNS}
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        onRowClick={setEditing}
        empty="Клиентов пока нет — добавьте через ~option"
      />
      {editing && <ClientForm client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ClientForm({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(client?.name ?? '');
  const [note, setNote] = useState(client?.note ?? '');
  const tooShort = name.trim().length > 0 && name.trim().length < 3;
  const save = useMutation({
    mutationFn: (input: ClientInput) =>
      client ? api.clients.update(client.id, input) : api.clients.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      onClose();
    },
  });

  return (
    <Modal
      title={client ? client.name : 'Новый клиент'}
      onClose={onClose}
      onSubmit={() => save.mutate({ name, note: note || null })}
      footer={
        <>
          {client && client.devices > 0 && (
            <a className="btn ghost" href={api.clients.exportUrl(client.id)} download>
              <Download size={16} /> Устройства клиента (CSV)
            </a>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={save.isPending || tooShort}>
            Сохранить
          </button>
        </>
      }
    >
      <ErrorBanner error={save.error} />
      <Field
        label="Наименование"
        required
        error={tooShort ? 'Не короче 3 символов' : undefined}
        hint="Уникально"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Заметка">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </Field>
      {client && (
        <p className="muted small">
          Поставок: {client.deliveries}, устройств: {client.devices}. Удаление и архив клиентов не
          предусмотрены.
        </p>
      )}
    </Modal>
  );
}
