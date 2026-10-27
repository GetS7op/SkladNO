import './styles.css';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ColumnPicker, DataTable } from '../../core/ui/DataTable';
import { formatDate, today } from '../../core/ui/format';
import { type DataColumn, useTableColumns } from '../../core/ui/tableColumns';
import { ErrorBanner, Field, Modal, Segmented } from '../../core/ui/ui';
import { useDebounced } from '../../core/ui/useDebounced';
import { ExportButtons } from '../reports/ExportButtons';
import type { Shipment, ShipmentFields } from './api';
import {
  useCreateShipments,
  useRecipients,
  useShipmentStats,
  useShipments,
  useUpdateShipment,
} from './hooks';

const date = (value: string | null) => (value ? formatDate(value) : '');

const COLUMNS: DataColumn<Shipment>[] = [
  {
    key: 'index',
    title: 'INDEX',
    text: (r) => r.device_index,
    render: (r) => (
      <Link to={`/inventory/${r.device_id}`} className="mono" onClick={(e) => e.stopPropagation()}>
        {r.device_index}
      </Link>
    ),
  },
  { key: 'device', title: 'Устройство', text: (r) => `${r.manufacturer} · ${r.model}` },
  { key: 'client', title: 'Клиент', text: (r) => r.client_name },
  { key: 'recipient', title: 'Кому', text: (r) => r.recipient },
  { key: 'packed', title: 'Упакован', text: (r) => r.packed_at, render: (r) => date(r.packed_at) },
  { key: 'shipped', title: 'Отправлен', text: (r) => r.shipped_at, render: (r) => date(r.shipped_at) },
  {
    key: 'arrived',
    title: 'Прибыл',
    text: (r) => r.arrived_at,
    render: (r) => (r.arrived_at ? date(r.arrived_at) : <span className="warn-text">не вернулось</span>),
  },
  { key: 'status', title: 'Статус', text: (r) => r.status_name },
  { key: 'comment', title: 'Комментарий', text: (r) => r.comment },
  { key: 'repair', title: 'Результат ремонта', text: (r) => r.repair_note },
  { key: 'author', title: 'Кто завёл', text: (r) => r.created_by, defaultHidden: true },
];

/**
 * Отправки устройств контрагенту и их возвращение (как «Техник → Отправки» в mf-old).
 * Даты двигают статус устройства: упаковали — «Упакован», отправили — «Возврат», вернулось — «Ремонт».
 */
export function ShipmentsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const open = params.get('open') === '1';
  const q = useDebounced(search);
  const list = useShipments({ q, open });
  const stats = useShipmentStats();
  const table = useTableColumns('shipments', COLUMNS);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);

  const setParam = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Отправки</h1>
          <p className="muted">
            Устройства, отправленные контрагенту в ремонт или клиенту, и их возвращение. Пока нет даты
            прибытия, отправка открыта и устройство нельзя упаковать повторно
          </p>
        </div>
        <div className="export-buttons">
          <ExportButtons registry="shipments" />
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> Новая отправка
          </button>
        </div>
      </header>

      <div className="tiles">
        <div className="tile">
          <span>Всего отправок</span>
          <b>{stats.data?.total ?? '…'}</b>
        </div>
        <div className="tile">
          <span>Не вернулись</span>
          <b>{stats.data?.open ?? '…'}</b>
        </div>
      </div>

      <div className="inventory-search">
        <Segmented
          value={open ? '1' : ''}
          onChange={(v) => setParam('open', v)}
          options={[
            { value: '', label: 'Все' },
            { value: '1', label: 'Не вернулись' },
          ]}
        />
        <label className="search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setParam('q', e.target.value);
            }}
            placeholder="INDEX, MAC, серийный, кому, комментарий, клиент"
            aria-label="Поиск отправок"
          />
        </label>
        <ColumnPicker table={table} />
      </div>

      <ErrorBanner error={list.error} />
      <p className="muted small found">
        Найдено отправок: <b>{list.data?.length ?? '…'}</b>
      </p>
      {list.data && list.data.length === 0 ? (
        <p className="empty-state">{search || open ? 'Ничего не найдено' : 'Отправок пока нет'}</p>
      ) : (
        <DataTable table={table} rows={list.data ?? []} rowKey={(r) => r.id} onRowClick={setEditing} />
      )}
      <p className="muted small">
        Клик по строке — даты и результат ремонта · клик по INDEX — карточка устройства
      </p>

      {creating && <NewShipmentForm onClose={() => setCreating(false)} />}
      {editing && <ShipmentForm shipment={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function useDates(initial: Partial<ShipmentFields>) {
  const [fields, setFields] = useState<ShipmentFields>({
    recipient: initial.recipient ?? null,
    packed_at: initial.packed_at ?? null,
    shipped_at: initial.shipped_at ?? null,
    arrived_at: initial.arrived_at ?? null,
    comment: initial.comment ?? null,
    repair_note: initial.repair_note ?? null,
  });
  const set = (key: keyof ShipmentFields) => (e: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: e.target.value || null }));
  return { fields, set, setFields };
}

function ShipmentFieldsForm({
  fields,
  set,
  withRepair,
}: {
  fields: ShipmentFields;
  set: (key: keyof ShipmentFields) => (e: { target: { value: string } }) => void;
  withRepair: boolean;
}) {
  const recipients = useRecipients();
  return (
    <>
      <Field label="Кому" hint="Контрагент или клиент — подсказки из прошлых отправок">
        <input value={fields.recipient ?? ''} onChange={set('recipient')} list="shipment-recipients" />
        <datalist id="shipment-recipients">
          {recipients.data?.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </Field>
      <div className="grid-3">
        <Field label="Упакован">
          <input type="date" value={fields.packed_at ?? ''} onChange={set('packed_at')} />
        </Field>
        <Field label="Отправлен">
          <input type="date" value={fields.shipped_at ?? ''} onChange={set('shipped_at')} />
        </Field>
        <Field label="Прибыл">
          <input type="date" value={fields.arrived_at ?? ''} onChange={set('arrived_at')} />
        </Field>
      </div>
      <Field label="Комментарий" hint="Например, ошибка устройства">
        <input value={fields.comment ?? ''} onChange={set('comment')} />
      </Field>
      {withRepair && (
        <Field label="Результат ремонта">
          <textarea value={fields.repair_note ?? ''} onChange={set('repair_note')} rows={2} />
        </Field>
      )}
    </>
  );
}

function NewShipmentForm({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState('');
  const { fields, set } = useDates({ packed_at: today() });
  const create = useCreateShipments();
  const report = create.data;

  return (
    <Modal
      title="Новая отправка"
      onClose={onClose}
      onSubmit={() => (report ? onClose() : create.mutate({ devices, ...fields }))}
      footer={
        <>
          <span className="spacer" />
          {report ? (
            <button type="submit" className="btn primary">
              Готово
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>
                Отмена
              </button>
              <button type="submit" className="btn primary" disabled={create.isPending || !devices.trim()}>
                Записать
              </button>
            </>
          )}
        </>
      }
    >
      <ErrorBanner error={create.error} />
      {report ? (
        <div className="report">
          <p>
            Записано отправок: <b>{report.created.length}</b>
            {report.created.length > 0 && <span className="mono small"> {report.created.join(', ')}</span>}
          </p>
          {report.blocked.length > 0 && (
            <div className="banner error">
              Пропущены — у них есть незакрытая отправка:
              <ul>
                {report.blocked.map((b) => (
                  <li key={b.device_index}>
                    <b className="mono">{b.device_index}</b> — {b.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.missing_status && (
            <p className="warn-text">
              Статуса «{report.missing_status}» нет в справочнике — статус устройств не изменён. Добавьте его
              в «Настройки → Статусы».
            </p>
          )}
        </div>
      ) : (
        <>
          <Field
            label="Устройства"
            required
            hint="INDEX, диапазоны или MAC через запятую, пробел или с новой строки: 0000001-0000004, 0000007"
          >
            <textarea
              className="mono"
              value={devices}
              onChange={(e) => setDevices(e.target.value)}
              rows={3}
              autoFocus
              required
            />
          </Field>
          <ShipmentFieldsForm fields={fields} set={set} withRepair={false} />
        </>
      )}
    </Modal>
  );
}

function ShipmentForm({ shipment, onClose }: { shipment: Shipment; onClose: () => void }) {
  const { fields, set, setFields } = useDates(shipment);
  const update = useUpdateShipment();

  return (
    <Modal
      title={`Отправка ${shipment.device_index}`}
      onClose={onClose}
      onSubmit={() => update.mutate({ id: shipment.id, input: fields }, { onSuccess: onClose })}
      footer={
        <>
          {!fields.arrived_at && (
            <button
              type="button"
              className="btn"
              onClick={() => setFields((f) => ({ ...f, arrived_at: today() }))}
            >
              Прибыло сегодня
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={update.isPending}>
            Сохранить
          </button>
        </>
      }
    >
      <ErrorBanner error={update.error} />
      <p className="muted small">
        {shipment.manufacturer} {shipment.model} · {shipment.client_name} · статус:{' '}
        {shipment.status_name ?? '—'}
      </p>
      <ShipmentFieldsForm fields={fields} set={set} withRepair />
    </Modal>
  );
}
