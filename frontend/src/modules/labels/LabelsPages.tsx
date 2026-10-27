import './styles.css';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ErrorBanner } from '../../core/ui/ui';
import { useDelivery } from '../deliveries/hooks';
import { useMap } from '../locations/hooks';
import { formatAddress } from '../settings/api';
import { useAddressSeparator } from '../settings/hooks';
import { Barcode, LabelSheet } from './Labels';
import type { LabelLayout } from './layouts';

function useLayout() {
  const [params, setParams] = useSearchParams();
  const layout = (params.get('layout') === 'thermal' ? 'thermal' : 'a4') as LabelLayout;
  const setLayout = (value: LabelLayout) =>
    setParams(
      (p) => {
        p.set('layout', value);
        return p;
      },
      { replace: true },
    );
  return [layout, setLayout, params, setParams] as const;
}

/** Наклейки полок: штрихкод адреса MXCXSXP — его сканируют при приёме поставки. */
export function ShelfLabelsPage() {
  const [layout, setLayout, params, setParams] = useLayout();
  const module = params.get('module') ?? '';
  const map = useMap('');
  const separator = useAddressSeparator();
  const modules = [...new Set(map.data?.instances.map((i) => i.module_number))].sort((a, b) => a - b);

  const labels = (map.data?.instances ?? [])
    .filter((i) => !module || String(i.module_number) === module)
    .flatMap((i) =>
      Array.from({ length: i.racks }, (_, r) =>
        Array.from({ length: i.shelves_per_rack }, (_, s) => ({
          code: formatAddress(separator, i.module_number, i.number, r + 1, s + 1),
          caption: `Модуль ${i.module_number} · ${i.short_name} №${i.number} · стеллаж ${r + 1} · полка ${s + 1}`,
          warehouse: i.warehouse_name,
        })),
      ).flat(),
    );

  return (
    <LabelSheet
      title="Наклейки полок"
      subtitle={`Адрес полки ${['модуль', 'контейнер', 'стеллаж', 'полка'].join(` ${separator} `)} — сканируется ТСД при приёме поставки`}
      layout={layout}
      onLayout={setLayout}
      count={labels.length}
      toolbar={
        <select
          value={module}
          onChange={(e) =>
            setParams(
              (p) => {
                if (e.target.value) p.set('module', e.target.value);
                else p.delete('module');
                return p;
              },
              { replace: true },
            )
          }
          aria-label="Модуль"
        >
          <option value="">Все модули</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              Модуль №{m}
            </option>
          ))}
        </select>
      }
    >
      {map.error && <ErrorBanner error={map.error} />}
      {labels.map((l) => (
        <div key={l.code} className="label">
          <b className="label-main mono">{l.code}</b>
          <Barcode value={l.code} />
          <span className="label-caption">
            {l.caption} · {l.warehouse}
          </span>
        </div>
      ))}
    </LabelSheet>
  );
}

/** Наклейки устройств поставки: INDEX крупно и штрихкодом (шаг 2 поставки). */
export function DeviceLabelsPage() {
  const { id = '' } = useParams();
  const [layout, setLayout] = useLayout();
  const [onlyUnplaced, setOnlyUnplaced] = useState(false);
  const delivery = useDelivery(id);
  const devices = (delivery.data?.devices ?? []).filter((d) => !onlyUnplaced || !d.location);

  return (
    <>
      <Link to={`/deliveries/${id}`} className="back no-print">
        <ArrowLeft size={16} /> {delivery.data?.number ?? 'Поставка'}
      </Link>
      <LabelSheet
        title={`Наклейки устройств ${delivery.data?.number ?? ''}`}
        subtitle="INDEX устройства — сканируется ТСД после штрихкода полки"
        layout={layout}
        onLayout={setLayout}
        count={devices.length}
        toolbar={
          <label className="check">
            <input
              type="checkbox"
              checked={onlyUnplaced}
              onChange={(e) => setOnlyUnplaced(e.target.checked)}
            />
            Только не размещённые
          </label>
        }
      >
        {delivery.error && <ErrorBanner error={delivery.error} />}
        {devices.map((d) => (
          <div key={d.id} className="label">
            <b className="label-main mono">{d.device_index}</b>
            <Barcode value={d.device_index} />
            <span className="label-caption">
              {d.manufacturer} {d.model} · {delivery.data?.number}
            </span>
          </div>
        ))}
      </LabelSheet>
    </>
  );
}
