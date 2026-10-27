import './styles.css';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCan } from '../../core/auth/context';
import type { Destination } from '../../core/domain';
import { type Column, Registry } from '../../core/ui/Registry';
import { ErrorBanner, Field, Modal, Segmented } from '../../core/ui/ui';
import { useDebounced } from '../../core/ui/useDebounced';
import { exportOptions } from '../reports/exportOptions';
import type { Module, ModuleInput } from './api';
import { useContainers, useCreateModule, useModules, useUpdateModule, useWarehouseOptions } from './hooks';

const COLUMNS: Column<Module>[] = [
  { key: 'number', title: '№ модуля', render: (r) => <b className="mono">{r.number}</b> },
  { key: 'warehouse', title: 'Расположение', render: (r) => r.warehouse_name },
  {
    key: 'containers',
    title: 'Контейнеры',
    render: (r) => (
      <span className="chips">
        {r.containers.map((c) => (
          <span key={c.id} className="chip mono" title={c.container_name}>
            {c.number}·{c.short_name}
          </span>
        ))}
      </span>
    ),
  },
  { key: 'capacity', title: 'Мест', align: 'right', render: (r) => r.capacity },
  { key: 'placed', title: 'Занято', align: 'right', render: (r) => r.placed },
  { key: 'free', title: 'Свободно', align: 'right', render: (r) => r.capacity - r.placed },
];

/** F-08. Реестр модулей. */
export function ModulesPage() {
  const canEdit = useCan('senior');
  const [search, setSearch] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [editing, setEditing] = useState<Module | 'new' | null>(null);
  const q = useDebounced(search);
  const list = useModules({ q, warehouse });
  const warehouses = useWarehouseOptions();

  return (
    <>
      <Registry
        title="Реестр модулей"
        subtitle="Модуль — набор экземпляров контейнеров; номера входят в адрес MXCXSXP"
        search={search}
        onSearch={setSearch}
        options={[
          {
            label: 'Новый модуль',
            hidden: !canEdit,
            icon: <Plus size={16} />,
            onClick: () => setEditing('new'),
          },
          ...exportOptions('modules'),
        ]}
        filters={
          <Segmented
            value={warehouse}
            onChange={setWarehouse}
            options={[{ value: '', label: 'Все склады' }, ...warehouses]}
          />
        }
        columns={COLUMNS}
        rows={list.data}
        loading={list.isPending}
        error={list.error}
        rowKey={(r) => r.id}
        onRowClick={setEditing}
        empty="Модулей пока нет — добавьте через ~option"
      />
      {editing && <ModuleForm module={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

interface InstanceDraft {
  key: number;
  number: string;
  container_id: string;
  placed: number;
}

function ModuleForm({ module, onClose }: { module: Module | null; onClose: () => void }) {
  const [number, setNumber] = useState(module?.number.toString() ?? '');
  const [warehouse, setWarehouse] = useState<Destination>(module?.warehouse ?? '');
  const [instances, setInstances] = useState<InstanceDraft[]>(
    () =>
      module?.containers.map((c, i) => ({
        key: i + 1,
        number: c.number.toString(),
        container_id: c.container_id,
        placed: c.placed,
      })) ?? [{ key: 1, number: '1', container_id: '', placed: 0 }],
  );
  const containers = useContainers();
  const warehouses = useWarehouseOptions();
  const occupied = (module?.placed ?? 0) > 0;

  const createModule = useCreateModule();
  const updateModule = useUpdateModule();
  const save = module ? updateModule : createModule;
  const submit = (input: ModuleInput) =>
    module
      ? updateModule.mutate({ id: module.id, input }, { onSuccess: onClose })
      : createModule.mutate(input, { onSuccess: onClose });
  const update = (key: number, patch: Partial<InstanceDraft>) =>
    setInstances((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const nextNumber = () => Math.max(0, ...instances.map((i) => Number(i.number) || 0)) + 1;

  return (
    <Modal
      title={module ? `Модуль №${module.number}` : 'Новый модуль'}
      onClose={onClose}
      onSubmit={() =>
        submit({
          number: Number(number),
          warehouse,
          containers: instances.map((i) => ({ number: Number(i.number), container_id: i.container_id })),
        })
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
      <div className="grid-2">
        <Field
          label="Порядковый номер модуля"
          required
          hint={occupied ? 'В модуле есть устройства — номер входит в их адреса' : undefined}
        >
          <input
            type="number"
            min={1}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            required
            autoFocus
            disabled={occupied}
          />
        </Field>
        <Field
          label="Расположение модуля"
          required
          hint={
            occupied
              ? 'В модуле есть устройства — склад не меняется, пока они не перемещены'
              : 'Склад из справочника складов; новый склад добавляет администратор в разделе «Склады»'
          }
        >
          <select
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            required
            disabled={occupied}
          >
            <option value="">— выберите склад —</option>
            {warehouses.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="field">
        <span className="field-label">Контейнеры модуля</span>
        <div className="lines-scroll">
          <table className="table lines">
            <thead>
              <tr>
                <th>№ контейнера</th>
                <th>Тип контейнера</th>
                <th className="num">Занято</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {instances.map((inst) => (
                <tr key={inst.key}>
                  <td>
                    <input
                      className="qty"
                      type="number"
                      min={1}
                      value={inst.number}
                      onChange={(e) => update(inst.key, { number: e.target.value })}
                      required
                      disabled={inst.placed > 0}
                      aria-label="Номер контейнера"
                    />
                  </td>
                  <td>
                    <select
                      value={inst.container_id}
                      onChange={(e) => update(inst.key, { container_id: e.target.value })}
                      required
                      disabled={inst.placed > 0}
                      aria-label="Тип контейнера"
                    >
                      <option value="">— выберите тип —</option>
                      {containers.data?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.short_name} — {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{inst.placed}</td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setInstances((list) => list.filter((i) => i.key !== inst.key))}
                      disabled={instances.length === 1 || inst.placed > 0}
                      aria-label="Убрать контейнер"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            setInstances((list) => [
              ...list,
              {
                key: Math.random(),
                number: String(nextNumber()),
                container_id: list.at(-1)?.container_id ?? '',
                placed: 0,
              },
            ])
          }
        >
          <Plus size={16} /> Добавить контейнер
        </button>
        {containers.data?.length === 0 && (
          <span className="field-hint">
            Реестр контейнеров пуст — <Link to="/containers">добавьте шаблон</Link>.
          </span>
        )}
      </div>
    </Modal>
  );
}
