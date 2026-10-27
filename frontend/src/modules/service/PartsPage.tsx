import './styles.css';
import { ArrowRightLeft, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCan } from '../../core/auth/context';
import { formatDate, formatDateTime, today } from '../../core/ui/format';
import { ErrorBanner, Field, Modal, Segmented } from '../../core/ui/ui';
import { ExportButtons } from '../reports/ExportButtons';
import { MOVEMENT_ACTIONS, type MovementAction, movementLabel, type Part } from './api';
import {
  useCreateMovement,
  useCreatePart,
  useCreatePartType,
  useCreateReceipt,
  useMovements,
  usePartTypes,
  useParts,
  useReceipts,
  useUpdatePart,
} from './hooks';

type Tab = 'stock' | 'receipts' | 'movements';

/**
 * Склад комплектующих (как «Склад → Комплектующие» в mf-old): остатки по позициям, приход от
 * поставщика, установка в устройство, снятие и списание. Остаток = приход − установлено + снято − списано.
 */
export function PartsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'stock';
  const canEdit = useCan('senior');
  const [dialog, setDialog] = useState<'receipt' | 'movement' | 'part' | 'type' | Part | null>(null);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Комплектующие</h1>
          <p className="muted">Блоки питания, платы, вентиляторы: приход, установка в устройства и остатки</p>
        </div>
        <div className="export-buttons">
          <ExportButtons registry="parts" />
          <button type="button" className="btn" onClick={() => setDialog('receipt')}>
            <PackagePlus size={16} /> Приход
          </button>
          <button type="button" className="btn primary" onClick={() => setDialog('movement')}>
            <ArrowRightLeft size={16} /> Установка, снятие, списание
          </button>
        </div>
      </header>

      <Segmented
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        options={[
          { value: 'stock', label: 'Остатки' },
          { value: 'receipts', label: 'Приход' },
          { value: 'movements', label: 'Движение' },
        ]}
      />

      {tab === 'stock' && <StockTab canEdit={canEdit} onEdit={setDialog} />}
      {tab === 'receipts' && <ReceiptsTab />}
      {tab === 'movements' && <MovementsTab />}

      {dialog === 'receipt' && <ReceiptForm onClose={() => setDialog(null)} />}
      {dialog === 'movement' && <MovementForm onClose={() => setDialog(null)} />}
      {dialog === 'type' && <TypeForm onClose={() => setDialog(null)} />}
      {(dialog === 'part' || (dialog && typeof dialog === 'object')) && (
        <PartForm part={dialog === 'part' ? null : dialog} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function StockTab({
  canEdit,
  onEdit,
}: {
  canEdit: boolean;
  onEdit: (dialog: 'part' | 'type' | Part) => void;
}) {
  const parts = useParts();
  const total = parts.data?.reduce((sum, p) => sum + p.available, 0) ?? 0;
  return (
    <>
      <div className="inventory-search">
        <span className="muted small">
          Позиций: <b>{parts.data?.length ?? '…'}</b> · на складе всего: <b>{total}</b> шт.
        </span>
        <span className="spacer" />
        {canEdit && (
          <>
            <button type="button" className="btn ghost" onClick={() => onEdit('type')}>
              <Plus size={16} /> Тип
            </button>
            <button type="button" className="btn" onClick={() => onEdit('part')}>
              <Plus size={16} /> Позиция
            </button>
          </>
        )}
      </div>
      <ErrorBanner error={parts.error} />
      {parts.data?.length === 0 ? (
        <p className="empty-state">
          Позиций пока нет — Старший СА добавляет их кнопкой «Позиция», затем оформляется приход
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Позиция</th>
                <th>Тип</th>
                <th className="num">Приход</th>
                <th className="num">Установлено</th>
                <th className="num">Снято</th>
                <th className="num">Списано</th>
                <th className="num">На складе</th>
                <th>Примечание</th>
              </tr>
            </thead>
            <tbody>
              {parts.data?.map((p) => (
                <tr
                  key={p.id}
                  className={canEdit ? 'clickable' : undefined}
                  onClick={canEdit ? () => onEdit(p) : undefined}
                >
                  <td>
                    <b className="mono">{p.name}</b>
                  </td>
                  <td>{p.type_name ?? '—'}</td>
                  <td className="num">{p.received}</td>
                  <td className="num">{p.installed}</td>
                  <td className="num">{p.removed}</td>
                  <td className="num">{p.written_off}</td>
                  <td className="num">
                    <b className={p.available > 0 ? undefined : 'warn-text'}>{p.available}</b>
                  </td>
                  <td className="muted small">{p.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ReceiptsTab() {
  const receipts = useReceipts();
  return (
    <>
      <ErrorBanner error={receipts.error} />
      {receipts.data?.length === 0 ? (
        <p className="empty-state">Приходов пока нет</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Поставщик</th>
                <th>Документ</th>
                <th>Позиции</th>
                <th className="num">Штук</th>
                <th>Кто</th>
              </tr>
            </thead>
            <tbody>
              {receipts.data?.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.received_at)}</td>
                  <td>{r.supplier ?? '—'}</td>
                  <td>{r.document ?? '—'}</td>
                  <td className="wrap">{r.lines}</td>
                  <td className="num">{r.quantity}</td>
                  <td className="muted">{r.created_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function MovementsTab() {
  const movements = useMovements({});
  return (
    <>
      <ErrorBanner error={movements.error} />
      {movements.data?.length === 0 ? (
        <p className="empty-state">Движений пока нет</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Позиция</th>
                <th>Действие</th>
                <th className="num">Штук</th>
                <th>Устройство</th>
                <th>Примечание</th>
                <th>Кто</th>
              </tr>
            </thead>
            <tbody>
              {movements.data?.map((m) => (
                <tr key={m.id}>
                  <td>{formatDateTime(m.at)}</td>
                  <td className="mono">{m.part_name}</td>
                  <td>{movementLabel(m.action)}</td>
                  <td className="num">{m.quantity}</td>
                  <td>
                    {m.device_id ? (
                      <Link to={`/inventory/${m.device_id}`} className="mono">
                        {m.device_index}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="wrap">{m.note ?? ''}</td>
                  <td className="muted">{m.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FormFooter({
  onClose,
  pending,
  label = 'Сохранить',
}: {
  onClose: () => void;
  pending: boolean;
  label?: string;
}) {
  return (
    <>
      <span className="spacer" />
      <button type="button" className="btn" onClick={onClose}>
        Отмена
      </button>
      <button type="submit" className="btn primary" disabled={pending}>
        {label}
      </button>
    </>
  );
}

function ReceiptForm({ onClose }: { onClose: () => void }) {
  const parts = useParts();
  const create = useCreateReceipt();
  const [receivedAt, setReceivedAt] = useState(today());
  const [supplier, setSupplier] = useState('');
  const [document, setDocument] = useState('');
  const [lines, setLines] = useState([{ key: 1, part_id: '', quantity: '1' }]);
  const update = (key: number, patch: Partial<(typeof lines)[number]>) =>
    setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <Modal
      title="Приход комплектующих"
      onClose={onClose}
      onSubmit={() =>
        create.mutate(
          {
            received_at: receivedAt,
            supplier: supplier.trim() || null,
            document: document.trim() || null,
            note: null,
            lines: lines.map((l) => ({ part_id: l.part_id, quantity: Number(l.quantity) })),
          },
          { onSuccess: onClose },
        )
      }
      footer={<FormFooter onClose={onClose} pending={create.isPending} label="Оприходовать" />}
    >
      <ErrorBanner error={create.error} />
      <div className="grid-3">
        <Field label="Дата" required>
          <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} required />
        </Field>
        <Field label="Поставщик">
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label="Документ">
          <input value={document} onChange={(e) => setDocument(e.target.value)} />
        </Field>
      </div>
      <div className="field">
        <span className="field-label">Позиции</span>
        {lines.map((l) => (
          <div key={l.key} className="receipt-line">
            <select value={l.part_id} onChange={(e) => update(l.key, { part_id: e.target.value })} required>
              <option value="">— позиция —</option>
              {parts.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.type_name ? ` · ${p.type_name}` : ''}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={l.quantity}
              onChange={(e) => update(l.key, { quantity: e.target.value })}
              required
              aria-label="Количество"
            />
            <button
              type="button"
              className="btn ghost"
              aria-label="Убрать строку"
              disabled={lines.length === 1}
              onClick={() => setLines((list) => list.filter((x) => x.key !== l.key))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            setLines((list) => [
              ...list,
              { key: Math.max(...list.map((x) => x.key)) + 1, part_id: '', quantity: '1' },
            ])
          }
        >
          <Plus size={16} /> Строка
        </button>
        {parts.data?.length === 0 && (
          <p className="muted small">Сначала Старший СА добавляет позиции на вкладке «Остатки».</p>
        )}
      </div>
    </Modal>
  );
}

function MovementForm({ onClose }: { onClose: () => void }) {
  const parts = useParts();
  const create = useCreateMovement();
  const [partId, setPartId] = useState('');
  const [action, setAction] = useState<MovementAction>('installed');
  const [quantity, setQuantity] = useState('1');
  const [deviceIndex, setDeviceIndex] = useState('');
  const [note, setNote] = useState('');
  const part = parts.data?.find((p) => p.id === partId);

  return (
    <Modal
      title="Движение комплектующих"
      onClose={onClose}
      onSubmit={() =>
        create.mutate(
          {
            part_id: partId,
            action,
            quantity: Number(quantity),
            device_index: action === 'written_off' ? null : deviceIndex.trim() || null,
            note: note.trim() || null,
          },
          { onSuccess: onClose },
        )
      }
      footer={<FormFooter onClose={onClose} pending={create.isPending} label="Записать" />}
    >
      <ErrorBanner error={create.error} />
      <Segmented value={action} onChange={setAction} options={MOVEMENT_ACTIONS} />
      <Field label="Позиция" required hint={part ? `На складе: ${part.available} шт.` : undefined}>
        <select value={partId} onChange={(e) => setPartId(e.target.value)} required>
          <option value="">— позиция —</option>
          {parts.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · на складе {p.available}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid-2">
        <Field label="Количество" required>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </Field>
        {action !== 'written_off' && (
          <Field label="INDEX устройства" required hint="Попадёт в историю устройства">
            <input
              className="mono"
              value={deviceIndex}
              onChange={(e) => setDeviceIndex(e.target.value)}
              required
            />
          </Field>
        )}
      </div>
      <Field label="Примечание">
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

function PartForm({ part, onClose }: { part: Part | null; onClose: () => void }) {
  const types = usePartTypes();
  const create = useCreatePart();
  const update = useUpdatePart();
  const save = part ? update : create;
  const [name, setName] = useState(part?.name ?? '');
  const [typeId, setTypeId] = useState(part?.part_type_id ?? '');
  const [note, setNote] = useState(part?.note ?? '');
  const input = { name: name.trim(), part_type_id: typeId || null, note: note.trim() || null };

  return (
    <Modal
      title={part ? `Позиция ${part.name}` : 'Новая позиция'}
      onClose={onClose}
      onSubmit={() =>
        part
          ? update.mutate({ id: part.id, input }, { onSuccess: onClose })
          : create.mutate(input, { onSuccess: onClose })
      }
      footer={<FormFooter onClose={onClose} pending={save.isPending} />}
    >
      <ErrorBanner error={save.error} />
      <Field label="Название (модель)" required>
        <input className="mono" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Тип">
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">— без типа —</option>
          {types.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Примечание">
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

function TypeForm({ onClose }: { onClose: () => void }) {
  const create = useCreatePartType();
  const [name, setName] = useState('');
  return (
    <Modal
      title="Новый тип комплектующих"
      onClose={onClose}
      onSubmit={() => create.mutate(name.trim(), { onSuccess: onClose })}
      footer={<FormFooter onClose={onClose} pending={create.isPending} />}
    >
      <ErrorBanner error={create.error} />
      <Field label="Название" required hint="Например: Power supply, Hash Board">
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
    </Modal>
  );
}
