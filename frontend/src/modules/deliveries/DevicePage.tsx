import './styles.css';
import { ArrowLeft, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCan } from '../../core/auth/context';
import { formatDate, formatDateTime, formatNumber } from '../../core/ui/format';
import { ErrorBanner, Field, Modal } from '../../core/ui/ui';
import { AuditList } from '../audit/AuditPage';
import { DeviceServiceHistory, DeviceStatusCard } from '../service/DeviceService';
import type { DeviceCard } from './api';
import { useDevice, useUpdateDevice } from './hooks';
import { StageBadge } from './StageBadge';

/** Карточка устройства: где стоит, из какой поставки, MAC и серийный, история изменений. */
export function DevicePage() {
  const { id = '' } = useParams();
  const device = useDevice(id);
  const isSenior = useCan('senior');
  const [editing, setEditing] = useState(false);

  if (device.isPending) return <p className="page muted">Загрузка…</p>;
  if (device.error) return <ErrorBanner error={device.error} />;
  const d = device.data;
  // Данные устройства закрытой поставки правит только Старший СА (решает сервер).
  const canEdit = d.stage !== 'closed' || isSenior;

  return (
    <div className="page">
      <Link to="/inventory" className="back">
        <ArrowLeft size={16} /> Главная
      </Link>
      <header className="page-head">
        <div>
          <h1 className="mono">{d.device_index}</h1>
          <p className="muted">
            {d.manufacturer} {d.model} · {d.client_name}
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            <Pencil size={16} /> MAC и серийный
          </button>
        )}
      </header>

      <section className="card">
        <dl className="props">
          <dt>Модель</dt>
          <dd>
            {d.manufacturer} {d.model}
          </dd>
          <dt>XP / потребление</dt>
          <dd>
            {formatNumber(d.hashrate_ths, 2)} Th/s · {formatNumber(d.power_w)} Вт
          </dd>
          <dt>MAC</dt>
          <dd className="mono">{d.mac_address ?? '—'}</dd>
          <dt>Серийный номер</dt>
          <dd className="mono">{d.serial_no ?? '—'}</dd>
          <dt>UUID</dt>
          <dd className="mono small">{d.id}</dd>
          <dt>Поставка</dt>
          <dd>
            <Link to={`/deliveries/${d.delivery_id}`} className="mono">
              {d.delivery_number}
            </Link>{' '}
            от {formatDate(d.delivery_date)} <StageBadge stage={d.stage} />
          </dd>
          <dt>Склад</dt>
          <dd>{d.destination_name}</dd>
          <dt>Место</dt>
          <dd>
            {d.location ? (
              <Link to="/map" className="mono">
                {d.location}
              </Link>
            ) : (
              <span className="muted">не размещено</span>
            )}
          </dd>
          <dt>Заведено</dt>
          <dd>{formatDateTime(d.created_at)}</dd>
        </dl>
      </section>

      <DeviceStatusCard deviceId={d.id} statusId={d.status_id} />
      <DeviceServiceHistory deviceId={d.id} />

      <section className="card">
        <h2>История устройства</h2>
        <AuditList entity="device" entityId={d.id} compact />
      </section>

      {editing && <DeviceForm device={d} onClose={() => setEditing(false)} />}
    </div>
  );
}

function DeviceForm({ device, onClose }: { device: DeviceCard; onClose: () => void }) {
  const [mac, setMac] = useState(device.mac_address ?? '');
  const [serial, setSerial] = useState(device.serial_no ?? '');
  const save = useUpdateDevice();

  return (
    <Modal
      title={`Устройство ${device.device_index}`}
      onClose={onClose}
      onSubmit={() =>
        save.mutate(
          { id: device.id, mac_address: mac.trim() || null, serial_no: serial.trim() || null },
          { onSuccess: onClose },
        )
      }
      footer={
        <>
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
      <ErrorBanner error={save.error} />
      <Field label="MAC" hint="В любом написании; сохранится как CE:0B:0C:00:29:0A. Пусто — очистить.">
        <input className="mono" value={mac} onChange={(e) => setMac(e.target.value)} autoFocus />
      </Field>
      <Field label="Серийный номер" hint="Пусто — очистить">
        <input className="mono" value={serial} onChange={(e) => setSerial(e.target.value)} />
      </Field>
      <p className="muted small">Изменение попадёт в историю устройства: прежнее и новое значение.</p>
    </Modal>
  );
}
