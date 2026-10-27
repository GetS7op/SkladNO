import './styles.css';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useCan } from '../../core/auth/context';
import { ErrorBanner, Field, Modal } from '../../core/ui/ui';
import type { DeviceStatusRow, StatusesOverview } from './api';
import {
  useCreateCategory,
  useCreateStatus,
  useSaveTransitions,
  useStatuses,
  useUpdateCategory,
  useUpdateStatus,
} from './hooks';

type Category = StatusesOverview['categories'][number];

/**
 * Статусы устройств (как в mf-old): категории — где физически находится устройство, статусы и
 * матрица переходов — из какого статуса в какой СА может перевести устройство.
 */
export function StatusesPage() {
  const statuses = useStatuses();
  const canEdit = useCan('senior');
  const [editingStatus, setEditingStatus] = useState<DeviceStatusRow | 'new' | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | 'new' | null>(null);
  const data = statuses.data;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Статусы устройств</h1>
          <p className="muted">
            Статус показывает, что с устройством сейчас. Отправки ставят его сами: упаковали — «Упакован»,
            отправили — «Возврат», вернулось — «Ремонт»
          </p>
        </div>
      </header>
      <ErrorBanner error={statuses.error} />

      <section className="card">
        <div className="card-head">
          <h2>Статусы</h2>
          {canEdit && (
            <button type="button" className="btn" onClick={() => setEditingStatus('new')}>
              <Plus size={16} /> Статус
            </button>
          )}
        </div>
        <div className="lines-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Статус</th>
                <th>Категория</th>
                <th>Описание</th>
                <th className="num">Устройств</th>
              </tr>
            </thead>
            <tbody>
              {data?.statuses.map((s) => (
                <tr
                  key={s.id}
                  className={canEdit ? 'clickable' : undefined}
                  onClick={canEdit ? () => setEditingStatus(s) : undefined}
                >
                  <td>
                    <b>{s.name}</b>
                  </td>
                  <td>{s.category_name ?? '—'}</td>
                  <td className="muted small wrap">{s.note ?? ''}</td>
                  <td className="num">{s.devices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Категории</h2>
          {canEdit && (
            <button type="button" className="btn" onClick={() => setEditingCategory('new')}>
              <Plus size={16} /> Категория
            </button>
          )}
        </div>
        <ul className="category-list">
          {data?.categories.map((c) => (
            <li key={c.id}>
              <b>{c.name}</b>
              <span className="muted small">{c.note}</span>
              {canEdit && (
                <button
                  type="button"
                  className="btn ghost"
                  aria-label={`Изменить категорию ${c.name}`}
                  onClick={() => setEditingCategory(c)}
                >
                  <Pencil size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {data && <TransitionMatrix key={JSON.stringify(data.transitions)} data={data} canEdit={canEdit} />}

      {editingStatus && data && (
        <StatusForm
          status={editingStatus === 'new' ? null : editingStatus}
          categories={data.categories}
          onClose={() => setEditingStatus(null)}
        />
      )}
      {editingCategory && (
        <CategoryForm
          category={editingCategory === 'new' ? null : editingCategory}
          onClose={() => setEditingCategory(null)}
        />
      )}
    </div>
  );
}

/** Матрица: строка — из какого статуса, столбец — в какой можно перевести. */
function TransitionMatrix({ data, canEdit }: { data: StatusesOverview; canEdit: boolean }) {
  const [pairs, setPairs] = useState<[string, string][]>(data.transitions);
  const save = useSaveTransitions();
  const has = (from: string, to: string) => pairs.some(([a, b]) => a === from && b === to);
  const toggle = (from: string, to: string) =>
    setPairs((list) =>
      has(from, to) ? list.filter(([a, b]) => a !== from || b !== to) : [...list, [from, to]],
    );
  const changed = JSON.stringify([...pairs].sort()) !== JSON.stringify([...data.transitions].sort());

  return (
    <section className="card">
      <div className="card-head">
        <h2>Матрица переходов</h2>
        {canEdit && (
          <button
            type="button"
            className="btn primary"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate(pairs)}
          >
            Сохранить матрицу
          </button>
        )}
      </div>
      <p className="muted small">
        Строка — текущий статус, столбец — в какой СА может перевести устройство. Старший СА может поставить
        любой статус — такая смена помечается в журнале «вне матрицы». Устройство без статуса можно перевести
        в любой.
      </p>
      <ErrorBanner error={save.error} />
      <div className="lines-scroll">
        <table className="table matrix">
          <thead>
            <tr>
              <th>Из ↓ / в →</th>
              {data.statuses.map((s) => (
                <th key={s.id}>{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.statuses.map((from) => (
              <tr key={from.id}>
                <th>{from.name}</th>
                {data.statuses.map((to) => (
                  <td key={to.id}>
                    {from.id === to.id ? (
                      <span className="muted">—</span>
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`${from.name} → ${to.name}`}
                        checked={has(from.id, to.id)}
                        disabled={!canEdit}
                        onChange={() => toggle(from.id, to.id)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusForm({
  status,
  categories,
  onClose,
}: {
  status: DeviceStatusRow | null;
  categories: Category[];
  onClose: () => void;
}) {
  const [name, setName] = useState(status?.name ?? '');
  const [categoryId, setCategoryId] = useState(status?.category_id ?? '');
  const [note, setNote] = useState(status?.note ?? '');
  const create = useCreateStatus();
  const update = useUpdateStatus();
  const save = status ? update : create;
  const input = { name: name.trim(), category_id: categoryId || null, note: note.trim() || null };

  return (
    <Modal
      title={status ? `Статус «${status.name}»` : 'Новый статус'}
      onClose={onClose}
      onSubmit={() =>
        status
          ? update.mutate({ id: status.id, input }, { onSuccess: onClose })
          : create.mutate(input, { onSuccess: onClose })
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
      <Field
        label="Название"
        required
        hint={
          status && ['Упакован', 'Возврат', 'Ремонт'].includes(status.name)
            ? 'Этот статус ставят отправки — при переименовании отправки перестанут менять статус'
            : undefined
        }
      >
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Категория" hint="Где физически находится устройство">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">— без категории —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Описание">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
    </Modal>
  );
}

function CategoryForm({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const [name, setName] = useState(category?.name ?? '');
  const [note, setNote] = useState(category?.note ?? '');
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const save = category ? update : create;
  const input = { name: name.trim(), note: note.trim() || null };

  return (
    <Modal
      title={category ? `Категория «${category.name}»` : 'Новая категория'}
      onClose={onClose}
      onSubmit={() =>
        category
          ? update.mutate({ id: category.id, input }, { onSuccess: onClose })
          : create.mutate(input, { onSuccess: onClose })
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
      <Field label="Название" required>
        <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      <Field label="Описание">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
    </Modal>
  );
}
