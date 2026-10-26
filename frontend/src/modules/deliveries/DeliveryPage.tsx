import './styles.css';
import { ArrowLeft, Check, Download, Printer, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCan } from '../../core/auth/context';
import { STAGES, conditionLabel, destinationLabel } from '../../core/domain';
import { downloadCsv, formatDate } from '../../core/ui/format';
import { ErrorBanner } from '../../core/ui/ui';
import { AuditList } from '../audit/AuditPage';
import { ScanPanel } from '../locations/ScanPanel';
import { type DeliveryDetail, getDeliveryWarnings } from './api';
import { DeliveryFiles } from './DeliveryFiles';
import { useAdvanceDelivery, useDelivery } from './hooks';
import { StageBadge } from './StageBadge';

/** F-03: карточка поставки — шапка, этапы, строки с диапазонами Index, устройства. */
export function DeliveryPage() {
  const { id = '' } = useParams();
  const delivery = useDelivery(id);

  if (delivery.isPending) return <p className="page muted">Загрузка…</p>;
  if (delivery.error) return <ErrorBanner error={delivery.error} />;
  const d = delivery.data;

  return (
    <div className="page">
      <Link to="/deliveries" className="back">
        <ArrowLeft size={16} /> Поставки
      </Link>
      <header className="page-head">
        <div>
          <h1 className="mono">{d.number}</h1>
          <p className="muted">
            {d.client_name} · {formatDate(d.delivery_date)} · {destinationLabel(d.destination)}
          </p>
        </div>
        <StageBadge stage={d.stage} />
      </header>

      <StageStepper delivery={d} />

      {d.stage === 'receiving' && (
        <ScanPanel
          hint={`Шаг 3: сканируйте штрихкод полки склада «${destinationLabel(d.destination)}», затем INDEX с наклейки. Размещено ${placedCount(d)} из ${d.devices.length}.`}
        />
      )}

      <section className="card">
        <h2>Шапка</h2>
        <dl className="props">
          <dt>Клиент</dt>
          <dd>{d.client_name}</dd>
          <dt>Группа устройств</dt>
          <dd>{d.device_group ?? '—'}</dd>
          <dt>Дата</dt>
          <dd>{formatDate(d.delivery_date)}</dd>
          <dt>Документ-основание</dt>
          <dd>
            {d.basis_doc ? `${d.basis_doc}${d.basis_date ? ` от ${formatDate(d.basis_date)}` : ''}` : '—'}
          </dd>
          <dt>Назначение</dt>
          <dd>{destinationLabel(d.destination)}</dd>
          <dt>Состояние</dt>
          <dd>
            {conditionLabel(d.condition)}
            {d.customs && <span className="badge yes customs">таможенные</span>}
          </dd>
        </dl>
      </section>

      <DeliveryFiles deliveryId={d.id} />

      <section className="card">
        <h2>Строки</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Модель</th>
              <th className="num">Количество</th>
              <th>Диапазон Index</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.model_id}>
                <td>
                  {l.manufacturer} <b>{l.model}</b>
                </td>
                <td className="num">{l.quantity}</td>
                <td className="mono">
                  {l.first_index === l.last_index ? l.first_index : `${l.first_index} – ${l.last_index}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <DevicesCard delivery={d} />

      <section className="card">
        <h2>Журнал поставки</h2>
        <AuditList entity="delivery" entityId={d.id} compact />
      </section>
    </div>
  );
}

function StageStepper({ delivery }: { delivery: DeliveryDetail }) {
  const isSenior = useCan('senior');
  const current = STAGES.findIndex((s) => s.value === delivery.stage);
  const next = STAGES[current + 1];
  const advance = useAdvanceDelivery();

  return (
    <section className="card">
      <ol className="stepper">
        {STAGES.map((s, i) => (
          <li key={s.value} className={i < current ? 'done' : i === current ? 'current' : undefined}>
            <span className="dot">{i < current ? <Check size={14} /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
      <ErrorBanner error={advance.error} />
      {next && next.value !== 'receiving' && !isSenior && (
        <p className="muted small stepper-action">Подтверждение и закрытие поставки выполняет Старший СА.</p>
      )}
      {next && (next.value === 'receiving' || isSenior) && (
        <div className="stepper-action">
          <button
            type="button"
            className="btn primary"
            disabled={advance.isPending}
            onClick={async () => {
              // Подтверждение и закрытие: замечания не блокируют этап, но их нужно увидеть (SPEC).
              const warnings =
                next.value === 'receiving' ? [] : (await getDeliveryWarnings(delivery.id)).warnings;
              const text = warnings.length
                ? `Есть замечания:\n• ${warnings.join('\n• ')}\n\nВсё равно перевести поставку ${delivery.number} на этап «${next.label}»? Замечания будут записаны в журнал.`
                : `Перевести поставку ${delivery.number} на этап «${next.label}»?`;
              if (window.confirm(text)) advance.mutate({ id: delivery.id, expectedStage: delivery.stage });
            }}
          >
            Перевести на этап «{next.label}»
          </button>
        </div>
      )}
    </section>
  );
}

const placedCount = (d: DeliveryDetail) => d.devices.filter((v) => v.location).length;

function DevicesCard({ delivery }: { delivery: DeliveryDetail }) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const rows = needle
    ? delivery.devices.filter((v) =>
        `${v.device_index} ${v.manufacturer} ${v.model} ${v.id} ${v.location ?? ''} ${v.mac_address ?? ''} ${v.serial_no ?? ''}`
          .toLowerCase()
          .includes(needle),
      )
    : delivery.devices;

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          Устройства ({delivery.devices.length}, размещено {placedCount(delivery)})
        </h2>
        <label className="search small">
          <Search size={14} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Index, модель, MAC, серийный"
          />
        </label>
        <Link to={`/labels/delivery/${delivery.id}`} className="btn ghost">
          <Printer size={16} /> Наклейки
        </Link>
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            downloadCsv(
              `${delivery.number}.csv`,
              ['Index', 'UUID', 'Производитель', 'Модель', 'Место'],
              delivery.devices.map((v) => [v.device_index, v.id, v.manufacturer, v.model, v.location]),
            )
          }
        >
          <Download size={16} /> CSV для наклеек
        </button>
      </div>
      <div className="table-wrap scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Модель</th>
              <th>Место</th>
              <th>MAC</th>
              <th>Серийный номер</th>
              <th>UUID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td className="mono">
                  <b>{v.device_index}</b>
                </td>
                <td>
                  {v.manufacturer} {v.model}
                </td>
                <td className="mono">{v.location ?? <span className="muted">не размещено</span>}</td>
                <td className="mono">{v.mac_address ?? '—'}</td>
                <td className="mono small">{v.serial_no ?? '—'}</td>
                <td className="mono muted">{v.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
