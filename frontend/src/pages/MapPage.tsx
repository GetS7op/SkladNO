import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MapData, type MapInstance } from '../api';
import { ScanPanel } from '../components/ScanPanel';
import { Segmented } from '../components/ui';
import { DESTINATIONS, destinationLabel, formatNumber } from '../format';

/** F-09. Карта местоположений: модуль → контейнер → стеллаж → полка (адрес MXCXSXP). */
export function MapPage() {
  const [warehouse, setWarehouse] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const map = useQuery({ queryKey: ['map', warehouse], queryFn: () => api.map.get(warehouse) });

  const modules = groupByModule(map.data);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Карта местоположений</h1>
          <p className="muted">
            Адрес полки: модуль X контейнер X стеллаж X полка. Клик по полке — что на ней.
          </p>
        </div>
      </header>
      <ScanPanel hint="Размещать можно устройства поставок на этапе «Приём поставки», только на полки своего склада." />
      <div className="registry-toolbar">
        <Segmented
          value={warehouse}
          onChange={setWarehouse}
          options={[{ value: '', label: 'Все склады' }, ...DESTINATIONS]}
        />
        <span className="legend">
          <i className="cell" /> свободно <i className="cell partial" /> частично <i className="cell full" />{' '}
          заполнено
        </span>
      </div>
      {map.isPending && <p className="muted">Загрузка…</p>}
      {map.error && <p className="error">{map.error.message}</p>}
      {map.data && modules.length === 0 && (
        <p className="muted">
          Модулей нет — сначала заведите <Link to="/containers">контейнеры</Link> и{' '}
          <Link to="/modules">модули</Link>.
        </p>
      )}
      {modules.map(({ number, location, warehouse: wh, instances }) => (
        <section key={number} className="card">
          <div className="card-head">
            <h2>Модуль №{number}</h2>
            <span className="muted">
              {location ?? 'расположение не указано'} · {destinationLabel(wh)}
            </span>
          </div>
          <div className="instances">
            {instances.map((inst) => (
              <InstanceGrid
                key={inst.id}
                instance={inst}
                counts={map.data!.shelves}
                selected={selected}
                onSelect={setSelected}
              />
            ))}
          </div>
        </section>
      ))}
      {selected && <ShelfDetails code={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function groupByModule(data?: MapData) {
  const modules: {
    number: number;
    location: string | null;
    warehouse: MapInstance['warehouse'];
    instances: MapInstance[];
  }[] = [];
  for (const inst of data?.instances ?? []) {
    let m = modules.find((x) => x.number === inst.module_number);
    if (!m) {
      m = { number: inst.module_number, location: inst.location, warehouse: inst.warehouse, instances: [] };
      modules.push(m);
    }
    m.instances.push(inst);
  }
  return modules;
}

function InstanceGrid(props: {
  instance: MapInstance;
  counts: MapData['shelves'];
  selected: string | null;
  onSelect: (code: string) => void;
}) {
  const { instance: i } = props;
  const count = (rack: number, shelf: number) =>
    props.counts.find((c) => c.module_container_id === i.id && c.rack === rack && c.shelf === shelf)?.count ??
    0;
  const loadKw = i.load_w / 1000;
  const loadPct = Math.min(100, (loadKw / i.power_kw) * 100);
  const racks = Array.from({ length: i.racks }, (_, r) => r + 1);
  const shelves = Array.from({ length: i.shelves_per_rack }, (_, s) => i.shelves_per_rack - s);

  return (
    <div className="instance">
      <div className="instance-head">
        <b>
          Контейнер №{i.number} · {i.short_name}
        </b>
        <span className="muted small">
          {formatNumber(loadKw, 2)} / {formatNumber(i.power_kw, 2)} кВт
        </span>
      </div>
      <div className="meter" title={`Нагрузка ${Math.round(loadPct)}%`}>
        <span style={{ width: `${loadPct}%` }} className={loadPct >= 90 ? 'hot' : undefined} />
      </div>
      <div className="racks">
        {racks.map((rack) => (
          <div key={rack} className="rack">
            {shelves.map((shelf) => {
              const n = count(rack, shelf);
              const code = `${i.module_number}X${i.number}X${rack}X${shelf}`;
              const state = n === 0 ? '' : n >= i.devices_per_shelf ? 'full' : 'partial';
              return (
                <button
                  key={shelf}
                  type="button"
                  className={`cell ${state}${props.selected === code ? ' selected' : ''}`}
                  title={`${code}: ${n} из ${i.devices_per_shelf}`}
                  onClick={() => props.onSelect(code)}
                >
                  {n}/{i.devices_per_shelf}
                </button>
              );
            })}
            <span className="rack-label">С{rack}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShelfDetails({ code, onClose }: { code: string; onClose: () => void }) {
  const shelf = useQuery({ queryKey: ['map', 'shelf', code], queryFn: () => api.map.shelf(code) });
  return (
    <section className="card shelf-details">
      <div className="card-head">
        <h2 className="mono">Полка {code}</h2>
        {shelf.data && (
          <span className="muted">
            {shelf.data.devices.length} из {shelf.data.capacity}
          </span>
        )}
        <button type="button" className="btn ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>
      {shelf.error && <p className="error">{shelf.error.message}</p>}
      {shelf.data?.devices.length === 0 && <p className="muted">Полка пуста</p>}
      {shelf.data && shelf.data.devices.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Модель</th>
              <th>Поставка</th>
            </tr>
          </thead>
          <tbody>
            {shelf.data.devices.map((d) => (
              <tr key={d.device_index}>
                <td className="mono">
                  <b>{d.device_index}</b>
                </td>
                <td>
                  {d.manufacturer} {d.model}
                </td>
                <td className="mono">{d.delivery_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
