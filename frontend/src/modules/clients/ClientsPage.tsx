import { Download, FileUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { useCan } from '../../core/auth/context';
import { type Column, Registry } from '../../core/ui/Registry';
import { ErrorBanner, Field, Modal } from '../../core/ui/ui';
import { useDebounced } from '../../core/ui/useDebounced';
import { ImportDialog } from '../reports/ExportImport';
import { exportOptions } from '../reports/exportOptions';
import { type Client, type ClientInput, clientDevicesCsvUrl } from './api';
import { useClients, useCreateClient, useUpdateClient } from './hooks';

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
  const canEdit = useCan('senior');
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const q = useDebounced(search);
  const list = useClients(q);

  return (
    <>
      <Registry
        title="Клиенты"
        subtitle="Сводка по поставкам и устройствам каждого клиента"
        search={search}
        onSearch={setSearch}
        options={[
          {
            label: 'Новый клиент',
            hidden: !canEdit,
            icon: <Plus size={16} />,
            onClick: () => setEditing('new'),
          },
          {
            label: 'Импорт из CSV / XLSX',
            hidden: !canEdit,
            icon: <FileUp size={16} />,
            onClick: () => setImporting(true),
          },
          ...exportOptions('clients'),
        ]}
        columns={COLUMNS}
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        onRowClick={setEditing}
        empty="Клиентов пока нет — добавьте через ~option"
      />
      {importing && <ImportDialog registry="clients" onClose={() => setImporting(false)} />}
      {editing && <ClientForm client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ClientForm({ client, onClose }: { client: Client | null; onClose: () => void }) {
  const [name, setName] = useState(client?.name ?? '');
  const [note, setNote] = useState(client?.note ?? '');
  const tooShort = name.trim().length > 0 && name.trim().length < 3;
  const create = useCreateClient();
  const update = useUpdateClient();
  const save = client ? update : create;
  const submit = (input: ClientInput) =>
    client
      ? update.mutate({ id: client.id, input }, { onSuccess: onClose })
      : create.mutate(input, { onSuccess: onClose });

  return (
    <Modal
      title={client ? client.name : 'Новый клиент'}
      onClose={onClose}
      onSubmit={() => submit({ name, note: note || null })}
      footer={
        <>
          {client && client.devices > 0 && (
            <a className="btn ghost" href={clientDevicesCsvUrl(client.id)} download>
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
