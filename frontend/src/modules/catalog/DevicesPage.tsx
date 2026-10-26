import { Archive, ArchiveRestore, FileUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { useCan } from '../../core/auth/context';
import { formatDimensions, formatNumber } from '../../core/ui/format';
import { type Column, Registry } from '../../core/ui/Registry';
import { ErrorBanner, Field, Modal, Segmented } from '../../core/ui/ui';
import { useDebounced } from '../../core/ui/useDebounced';
import { ImportDialog } from '../reports/ExportImport';
import { exportOptions } from '../reports/exportOptions';
import type { DeviceModel, DeviceModelInput } from './api';
import {
  useCreateDeviceModel,
  useDeviceModels,
  useManufacturers,
  useSetDeviceModelArchived,
  useUpdateDeviceModel,
} from './hooks';

const COLUMNS: Column<DeviceModel>[] = [
  { key: 'manufacturer', title: 'Производитель', render: (r) => r.manufacturer },
  { key: 'model', title: 'Модель', render: (r) => <b>{r.model}</b> },
  { key: 'hashrate', title: 'XP, Th/s', align: 'right', render: (r) => formatNumber(r.hashrate_ths, 2) },
  { key: 'power', title: 'Потребление, Вт', align: 'right', render: (r) => formatNumber(r.power_w) },
  { key: 'size', title: 'Размеры, мм', render: (r) => r.dimensions_mm ?? '—' },
  { key: 'weight', title: 'Вес, кг', render: (r) => r.weight_kg ?? '—' },
];

type Editing = { mode: 'create' } | { mode: 'edit'; row: DeviceModel };

/** F-01. Реестр устройств и характеристик. */
export function DevicesPage() {
  const canEdit = useCan('senior');
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'active' | 'archive'>('active');
  const [editing, setEditing] = useState<Editing | null>(null);
  const q = useDebounced(search);
  const archived = view === 'archive';
  const list = useDeviceModels({ q, archived });

  return (
    <>
      <Registry
        title="Устройства"
        subtitle="Справочник моделей: производитель + модель и их характеристики"
        search={search}
        onSearch={setSearch}
        options={[
          {
            label: 'Новая модель',
            hidden: !canEdit,
            icon: <Plus size={16} />,
            onClick: () => setEditing({ mode: 'create' }),
          },
          {
            label: 'Импорт из CSV / XLSX',
            hidden: !canEdit,
            icon: <FileUp size={16} />,
            onClick: () => setImporting(true),
          },
          ...exportOptions('devices'),
        ]}
        filters={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'active', label: 'Активные' },
              { value: 'archive', label: 'Архив' },
            ]}
          />
        }
        columns={COLUMNS}
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        onRowClick={(row) => setEditing({ mode: 'edit', row })}
        empty={archived ? 'В архиве пусто' : 'Моделей пока нет — добавьте через ~option'}
      />
      {importing && <ImportDialog registry="devices" onClose={() => setImporting(false)} />}
      {editing && <DeviceForm editing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DeviceForm({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const initial = editing.mode === 'edit' ? editing.row : null;
  const [form, setForm] = useState({
    manufacturer: initial?.manufacturer ?? '',
    model: initial?.model ?? '',
    hashrate: initial?.hashrate_ths?.toString() ?? '',
    power: initial?.power_w?.toString() ?? '',
    dimensions: initial?.dimensions_mm ?? '',
    weight: initial?.weight_kg ?? '',
  });
  const manufacturers = useManufacturers();
  const dims = formatDimensions(form.dimensions);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useCreateDeviceModel();
  const update = useUpdateDeviceModel();
  const toggleArchive = useSetDeviceModelArchived();
  const save = initial ? update : create;
  const submit = (input: DeviceModelInput) =>
    initial
      ? update.mutate({ id: initial.id, input }, { onSuccess: onClose })
      : create.mutate(input, { onSuccess: onClose });

  const toNumber = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

  return (
    <Modal
      title={initial ? `${initial.manufacturer} ${initial.model}` : 'Новая модель'}
      onClose={onClose}
      onSubmit={() =>
        submit({
          manufacturer: form.manufacturer,
          model: form.model,
          hashrate_ths: toNumber(form.hashrate),
          power_w: toNumber(form.power),
          dimensions_mm: form.dimensions,
          weight_kg: form.weight,
        })
      }
      footer={
        <>
          {initial && (
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                toggleArchive.mutate({ id: initial.id, archived: !initial.archived }, { onSuccess: onClose })
              }
              disabled={toggleArchive.isPending}
            >
              {initial.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              {initial.archived ? 'Вернуть из архива' : 'В архив'}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary" disabled={save.isPending || !!dims.error}>
            Сохранить
          </button>
        </>
      }
    >
      <ErrorBanner error={save.error ?? toggleArchive.error} />
      <div className="grid-2">
        <Field label="Производитель" required>
          <input
            value={form.manufacturer}
            onChange={set('manufacturer')}
            list="manufacturers"
            required
            autoFocus
          />
          <datalist id="manufacturers">
            {manufacturers.data?.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Модель" required>
          <input value={form.model} onChange={set('model')} required />
        </Field>
        <Field label="Хешрейт (XP), Th/s">
          <input value={form.hashrate} onChange={set('hashrate')} inputMode="decimal" />
        </Field>
        <Field label="Энергопотребление, Вт">
          <input value={form.power} onChange={set('power')} inputMode="numeric" />
        </Field>
        <Field
          label="Размеры, мм"
          error={dims.error}
          hint={
            dims.value ? (
              <>
                Сохранится как <b>{dims.value}</b>
              </>
            ) : (
              'Три числа через пробел или x'
            )
          }
        >
          <input value={form.dimensions} onChange={set('dimensions')} placeholder="400 195 290" />
        </Field>
        <Field label="Вес, кг" hint="Число или диапазон, например 14–16">
          <input value={form.weight} onChange={set('weight')} />
        </Field>
      </div>
      <p className="muted small">Удаление моделей запрещено — неиспользуемые переносятся в архив.</p>
    </Modal>
  );
}
