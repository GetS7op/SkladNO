import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api, type Container, type ContainerInput } from '../api';
import { exportOptions } from '../components/ExportImport';
import { type Column, Registry } from '../components/Registry';
import { ErrorBanner, Field, Modal } from '../components/ui';
import { formatDimensions, formatNumber } from '../format';
import { useDebounced } from '../hooks';
import { useCan } from '../auth';

const COLUMNS: Column<Container>[] = [
  { key: 'name', title: 'Наименование', render: (r) => <b>{r.name}</b> },
  { key: 'short', title: 'Сокращение', render: (r) => <span className="mono">{r.short_name}</span> },
  { key: 'power', title: 'Мощность, кВт', align: 'right', render: (r) => formatNumber(r.power_kw, 2) },
  { key: 'racks', title: 'Стеллажей', align: 'right', render: (r) => r.racks },
  { key: 'shelves', title: 'Полок на стеллаж', align: 'right', render: (r) => r.shelves_per_rack },
  { key: 'per', title: 'Устройств на полку', align: 'right', render: (r) => r.devices_per_shelf },
  {
    key: 'places',
    title: 'Мест',
    align: 'right',
    render: (r) => <b>{r.racks * r.shelves_per_rack * r.devices_per_shelf}</b>,
  },
  { key: 'dims', title: 'Полка, мм', render: (r) => r.shelf_dims_mm ?? '—' },
  { key: 'inst', title: 'В модулях', align: 'right', render: (r) => r.instances },
];

/** F-07. Контейнеры (шаблоны). */
export function ContainersPage() {
  const canEdit = useCan('senior');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Container | 'new' | null>(null);
  const q = useDebounced(search);
  const list = useQuery({ queryKey: ['containers', q], queryFn: () => api.containers.list(q) });

  return (
    <>
      <Registry
        title="Контейнеры"
        subtitle="Шаблоны контейнеров: мощность, стеллажи, полки и вместимость"
        search={search}
        onSearch={setSearch}
        options={[
          {
            label: 'Новый контейнер',
            hidden: !canEdit,
            icon: <Plus size={16} />,
            onClick: () => setEditing('new'),
          },
          ...exportOptions('containers'),
        ]}
        columns={COLUMNS}
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        onRowClick={setEditing}
        empty="Контейнеров пока нет — добавьте через ~option"
      />
      {editing && (
        <ContainerForm container={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function ContainerForm({ container, onClose }: { container: Container | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: container?.name ?? '',
    short_name: container?.short_name ?? '',
    power_kw: container?.power_kw.toString() ?? '',
    racks: container?.racks.toString() ?? '1',
    shelves_per_rack: container?.shelves_per_rack.toString() ?? '1',
    devices_per_shelf: container?.devices_per_shelf.toString() ?? '1',
    shelf_dims_mm: container?.shelf_dims_mm ?? '',
    description: container?.description ?? '',
  });
  const dims = formatDimensions(form.shelf_dims_mm);
  const places = Number(form.racks) * Number(form.shelves_per_rack) * Number(form.devices_per_shelf) || 0;
  const save = useMutation({
    mutationFn: (input: ContainerInput) =>
      container ? api.containers.update(container.id, input) : api.containers.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
      queryClient.invalidateQueries({ queryKey: ['modules'] });
      queryClient.invalidateQueries({ queryKey: ['map'] });
      onClose();
    },
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Modal
      title={container ? container.name : 'Новый контейнер'}
      onClose={onClose}
      onSubmit={() =>
        save.mutate({
          name: form.name,
          short_name: form.short_name,
          power_kw: Number(form.power_kw.replace(',', '.')),
          racks: Number(form.racks),
          shelves_per_rack: Number(form.shelves_per_rack),
          devices_per_shelf: Number(form.devices_per_shelf),
          shelf_dims_mm: form.shelf_dims_mm || null,
          description: form.description || null,
        })
      }
      footer={
        <>
          <span className="muted">
            Мест в контейнере: <b>{places}</b>
          </span>
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
      <ErrorBanner error={save.error} />
      <div className="grid-2">
        <Field label="Наименование" required>
          <input value={form.name} onChange={set('name')} required autoFocus />
        </Field>
        <Field label="Сокращение" required>
          <input value={form.short_name} onChange={set('short_name')} required />
        </Field>
        <Field label="Мощность контейнера, кВт" required hint="Жёсткий предел при размещении">
          <input value={form.power_kw} onChange={set('power_kw')} inputMode="decimal" required />
        </Field>
        <Field label="Кол-во стеллажей" required>
          <input type="number" min={1} max={100} value={form.racks} onChange={set('racks')} required />
        </Field>
        <Field label="Кол-во полок на стеллаже" required>
          <input
            type="number"
            min={1}
            max={100}
            value={form.shelves_per_rack}
            onChange={set('shelves_per_rack')}
            required
          />
        </Field>
        <Field label="Кол-во устройств на полку" required>
          <input
            type="number"
            min={1}
            max={100}
            value={form.devices_per_shelf}
            onChange={set('devices_per_shelf')}
            required
          />
        </Field>
        <Field
          label="Габариты полки, мм"
          error={dims.error}
          hint={
            dims.value ? (
              <>
                Сохранится как <b>{dims.value}</b>
              </>
            ) : (
              'Три числа, например 600 400 300'
            )
          }
        >
          <input value={form.shelf_dims_mm} onChange={set('shelf_dims_mm')} />
        </Field>
      </div>
      <Field label="Описание">
        <textarea value={form.description} onChange={set('description')} rows={2} />
      </Field>
      {container && container.instances > 0 && (
        <p className="muted small">
          Контейнер используется в модулях ({container.instances}). Уменьшить стеллажи, полки, места на полке
          или мощность ниже занятого нельзя — система покажет затронутые устройства.
        </p>
      )}
    </Modal>
  );
}
