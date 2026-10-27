import './styles.css';
import { Download, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCan } from '../../core/auth/context';
import { download, formatIndex, formatNumber } from '../../core/ui/format';
import { ErrorBanner, Field, Modal } from '../../core/ui/ui';
import { exportUrl } from '../reports/api';
import { AddressSeparatorCard } from '../settings/AddressSeparatorCard';
import { maskRange, type Warehouse } from './api';
import { useCreateWarehouse, useRenameWarehouse, useWarehouses } from './hooks';

/** F-06. Склады: справочник (имя и маска INDEX) и сводка размещения и вместимости по карте. */
export function WarehousesPage() {
  const summary = useWarehouses();
  const isAdmin = useCan('admin');
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Склады</h1>
          <p className="muted">
            Вместимость, занятость и нагрузка по карте местоположений; маска INDEX задаёт номера устройств в
            поставках на склад
          </p>
        </div>
        <div className="export-buttons">
          {isAdmin && (
            <button type="button" className="btn primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Добавить склад
            </button>
          )}
          <span className="muted small">Реестр всех устройств:</span>
          {(['xlsx', 'csv', 'md'] as const).map((format) => (
            <button
              key={format}
              type="button"
              className="btn ghost"
              onClick={() => download(exportUrl('inventory', format))}
            >
              <Download size={16} /> {format.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      {summary.isPending && <p className="muted">Загрузка…</p>}
      {summary.error && <p className="error">{summary.error.message}</p>}
      <div className="warehouses">
        {summary.data?.map((w) => {
          const free = w.capacity - w.placed;
          const fill = w.capacity ? (w.placed / w.capacity) * 100 : 0;
          const issued = w.next_value - w.first_value;
          const rangeSize = w.max_value - w.first_value + 1;
          return (
            <section key={w.code} className="card warehouse">
              <div className="card-head">
                <h2>{w.name}</h2>
                <span className="warehouse-actions">
                  {isAdmin && (
                    <button
                      type="button"
                      className="btn ghost"
                      title="Переименовать склад"
                      aria-label={`Переименовать склад ${w.name}`}
                      onClick={() => setEditing(w)}
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  <Link to="/map" className="muted small">
                    на карте →
                  </Link>
                </span>
              </div>
              <div className="stats">
                <Stat label="Свободно мест" value={free} accent />
                <Stat label="Занято мест" value={w.placed} />
                <Stat label="Всего мест" value={w.capacity} />
              </div>
              <div className="meter big" title={`Заполнено ${Math.round(fill)}%`}>
                <span style={{ width: `${fill}%` }} className={fill >= 90 ? 'hot' : undefined} />
              </div>
              <dl className="props compact">
                <dt>Маска INDEX</dt>
                <dd>
                  <b className="mono">{w.index_mask}</b>{' '}
                  <span className="muted small">
                    {formatIndex(w.first_value)}–{formatIndex(w.max_value)}
                  </span>
                </dd>
                <dt>INDEX выдано</dt>
                <dd>
                  {issued.toLocaleString('ru-RU')} из {rangeSize.toLocaleString('ru-RU')}
                  {w.next_value <= w.max_value && (
                    <span className="muted small"> · следующий {formatIndex(w.next_value)}</span>
                  )}
                </dd>
                <dt>Модулей / контейнеров</dt>
                <dd>
                  {w.modules} / {w.containers}
                </dd>
                <dt>Устройств по поставкам</dt>
                <dd>{w.devices}</dd>
                <dt>Ожидают размещения</dt>
                <dd>{w.devices - w.placed}</dd>
                <dt>Нагрузка</dt>
                <dd>
                  {formatNumber(w.load_w / 1000, 2)} из {formatNumber(w.power_kw, 2)} кВт
                </dd>
              </dl>
            </section>
          );
        })}
      </div>
      <AddressSeparatorCard />
      {editing === 'new' && <NewWarehouseForm onClose={() => setEditing(null)} />}
      {editing && editing !== 'new' && <RenameForm warehouse={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function NewWarehouseForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [mask, setMask] = useState('');
  const create = useCreateWarehouse();
  const range = maskRange(mask);

  return (
    <Modal
      title="Новый склад"
      onClose={onClose}
      onSubmit={() => create.mutate({ name: name.trim(), index_mask: mask }, { onSuccess: onClose })}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={create.isPending || !range}>
            Добавить
          </button>
        </>
      }
    >
      <ErrorBanner error={create.error} />
      <Field label="Имя склада" required>
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
      </Field>
      <Field
        label="Маска INDEX"
        required
        error={mask && !range ? '7 знаков: цифры склада, затем X — например 1XXXXXX или 21XXXXX' : undefined}
        hint={
          range ? (
            <>
              INDEX поставок на склад: <b className="mono">{range.first}</b>–
              <b className="mono">{range.last}</b> ({range.count.toLocaleString('ru-RU')} устройств). Маску
              после создания изменить нельзя.
            </>
          ) : (
            'Цифры в начале — номер склада в INDEX, X — номер устройства. Диапазоны складов не должны пересекаться.'
          )
        }
      >
        <input
          className="mono"
          value={mask}
          onChange={(e) => setMask(e.target.value)}
          placeholder="1XXXXXX"
          maxLength={7}
          required
        />
      </Field>
    </Modal>
  );
}

function RenameForm({ warehouse, onClose }: { warehouse: Warehouse; onClose: () => void }) {
  const [name, setName] = useState(warehouse.name);
  const rename = useRenameWarehouse();

  return (
    <Modal
      title={`Склад «${warehouse.name}»`}
      onClose={onClose}
      onSubmit={() => rename.mutate({ code: warehouse.code, name: name.trim() }, { onSuccess: onClose })}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={rename.isPending}>
            Сохранить
          </button>
        </>
      }
    >
      <ErrorBanner error={rename.error} />
      <Field label="Имя склада" required>
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
      </Field>
      <p className="muted small">
        Маска INDEX <b className="mono">{warehouse.index_mask}</b> не меняется — по ней уже выдаются номера
        устройств.
      </p>
    </Modal>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`stat${accent ? ' accent' : ''}`}>
      <span>{label}</span>
      <b>{value.toLocaleString('ru-RU')}</b>
    </div>
  );
}
