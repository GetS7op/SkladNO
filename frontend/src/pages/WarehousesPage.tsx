import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { download, exportUrl } from '../components/ExportImport';
import { api } from '../api';
import { destinationLabel, formatNumber } from '../format';

/** F-06. Склады: сводка размещения и вместимости по Парку и Мастерской на основе карты. */
export function WarehousesPage() {
  const summary = useQuery({ queryKey: ['warehouses'], queryFn: api.map.warehouses });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Склады</h1>
          <p className="muted">
            Парк и Мастерская: вместимость, занятость и нагрузка по карте местоположений
          </p>
        </div>
        <div className="export-buttons">
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
          return (
            <section key={w.warehouse} className="card warehouse">
              <div className="card-head">
                <h2>{destinationLabel(w.warehouse)}</h2>
                <Link to="/map" className="muted small">
                  на карте →
                </Link>
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
    </div>
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
