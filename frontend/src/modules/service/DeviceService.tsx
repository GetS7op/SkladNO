import './styles.css';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useCan } from '../../core/auth/context';
import { formatDate, formatDateTime } from '../../core/ui/format';
import { ErrorBanner } from '../../core/ui/ui';
import { movementLabel } from './api';
import { useMovements, useSetDeviceStatus, useShipments, useStatuses } from './hooks';

/**
 * Статус устройства в карточке: СА переводит по матрице переходов, Старший СА — в любой
 * (такие варианты подписаны «вне матрицы»).
 */
export function DeviceStatusCard({ deviceId, statusId }: { deviceId: string; statusId: string | null }) {
  const statuses = useStatuses();
  const isSenior = useCan('senior');
  const change = useSetDeviceStatus();
  const [target, setTarget] = useState('');
  const data = statuses.data;
  const current = data?.statuses.find((s) => s.id === statusId);
  const allowed = new Set(
    statusId
      ? (data?.transitions ?? []).filter(([from]) => from === statusId).map(([, to]) => to)
      : (data?.statuses ?? []).map((s) => s.id),
  );
  const options = (data?.statuses ?? []).filter((s) => s.id !== statusId && (allowed.has(s.id) || isSenior));

  return (
    <section className="card">
      <div className="card-head">
        <h2>Статус</h2>
        <span className={`status-pill${current ? '' : ' muted'}`}>{current?.name ?? 'без статуса'}</span>
      </div>
      {current?.note && <p className="muted small">{current.note}</p>}
      <ErrorBanner error={change.error} />
      {options.length > 0 ? (
        <div className="status-change">
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Новый статус">
            <option value="">— перевести в статус —</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {allowed.has(s.id) ? '' : ' (вне матрицы)'}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn primary"
            disabled={!target || change.isPending}
            onClick={() => change.mutate({ deviceId, statusId: target }, { onSuccess: () => setTarget('') })}
          >
            Сменить
          </button>
        </div>
      ) : (
        <p className="muted small">
          Из этого статуса матрица не разрешает переходов. Сменить его может Старший СА.
        </p>
      )}
    </section>
  );
}

/** Отправки устройства и движение комплектующих по нему. */
export function DeviceServiceHistory({ deviceId }: { deviceId: string }) {
  const shipments = useShipments({ q: '', open: false, device_id: deviceId });
  const movements = useMovements({ device_id: deviceId });

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Отправки</h2>
          <Link to="/shipments" className="muted small">
            все отправки →
          </Link>
        </div>
        {shipments.data?.length ? (
          <div className="lines-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Кому</th>
                  <th>Упакован</th>
                  <th>Отправлен</th>
                  <th>Прибыл</th>
                  <th>Комментарий</th>
                  <th>Результат ремонта</th>
                </tr>
              </thead>
              <tbody>
                {shipments.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.recipient ?? '—'}</td>
                    <td>{s.packed_at ? formatDate(s.packed_at) : '—'}</td>
                    <td>{s.shipped_at ? formatDate(s.shipped_at) : '—'}</td>
                    <td>
                      {s.arrived_at ? formatDate(s.arrived_at) : <span className="muted">не вернулось</span>}
                    </td>
                    <td className="wrap">{s.comment ?? ''}</td>
                    <td className="wrap">{s.repair_note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">Устройство никуда не отправлялось</p>
        )}
      </section>
      {movements.data && movements.data.length > 0 && (
        <section className="card">
          <h2>Комплектующие</h2>
          <ul className="audit">
            {movements.data.map((m) => (
              <li key={m.id}>
                <time>{formatDateTime(m.at)}</time>
                <span className="who">{m.actor}</span>
                <span>
                  {m.part_name}: {movementLabel(m.action)} {m.quantity} шт.{m.note ? ` — ${m.note}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
