import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Destination } from '../api';
import { ErrorBanner, Field, Segmented } from '../components/ui';
import { DESTINATIONS, newRequestId, today } from '../format';

interface LineDraft {
  key: number;
  model_id: string;
  quantity: string;
}

/** F-03, шаг 1: создание поставки — шапка и строки «модель + количество». */
export function DeliveryCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Один ключ на всю форму: повторная отправка после сбоя сети не создаст дубликат.
  const [requestId] = useState(newRequestId);
  const [header, setHeader] = useState({
    client_id: '',
    device_group: '',
    delivery_date: today(),
    basis_doc: '',
    basis_date: '',
    destination: 'park' as Destination,
  });
  const [lines, setLines] = useState<LineDraft[]>([{ key: 1, model_id: '', quantity: '1' }]);

  const clients = useQuery({ queryKey: ['clients', ''], queryFn: () => api.clients.list('') });
  const models = useQuery({ queryKey: ['devices', '', false], queryFn: () => api.devices.list('', false) });
  const groups = useQuery({ queryKey: ['delivery-groups'], queryFn: api.deliveries.groups });
  const ranges = useQuery({ queryKey: ['index-ranges'], queryFn: api.deliveries.indexRanges });

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const range = ranges.data?.find((r) => r.destination === header.destination);
  const usedModels = new Set(lines.map((l) => l.model_id));
  const linesValid = lines.every(
    (l) => l.model_id && Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0,
  );
  const canSubmit = header.client_id && header.delivery_date && linesValid && total > 0;

  const create = useMutation({
    mutationFn: () =>
      api.deliveries.create({
        request_id: requestId,
        client_id: header.client_id,
        device_group: header.device_group || null,
        delivery_date: header.delivery_date,
        basis_doc: header.basis_doc || null,
        basis_date: header.basis_date || null,
        destination: header.destination,
        lines: lines.map((l) => ({ model_id: l.model_id, quantity: Number(l.quantity) })),
      }),
    onSuccess: (delivery) => {
      queryClient.invalidateQueries();
      navigate(`/deliveries/${delivery.id}`, { replace: true });
    },
  });

  const setField =
    (key: keyof typeof header) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setHeader((h) => ({ ...h, [key]: e.target.value }));
  const updateLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form
      className="page"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) create.mutate();
      }}
    >
      <Link to="/deliveries" className="back">
        <ArrowLeft size={16} /> Поставки
      </Link>
      <header className="page-head">
        <div>
          <h1>Новая поставка</h1>
          <p className="muted">Наименование ПУ-ГОД-НОМЕР присвоится автоматически</p>
        </div>
      </header>
      <ErrorBanner error={create.error} />

      <section className="card">
        <h2>Шапка</h2>
        <div className="grid-3">
          <Field label="Клиент" required>
            <select value={header.client_id} onChange={setField('client_id')} required>
              <option value="">— выберите —</option>
              {clients.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Группа устройств" hint="Выберите или введите новую">
            <input value={header.device_group} onChange={setField('device_group')} list="groups" />
            <datalist id="groups">
              {groups.data?.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </Field>
          <Field label="Дата" required>
            <input type="date" value={header.delivery_date} onChange={setField('delivery_date')} required />
          </Field>
          <Field label="Документ-основание">
            <input value={header.basis_doc} onChange={setField('basis_doc')} placeholder="Номер документа" />
          </Field>
          <Field label="Дата документа">
            <input type="date" value={header.basis_date} onChange={setField('basis_date')} />
          </Field>
          <Field
            label="Назначение"
            required
            hint={range && `Следующий Index: ${String(range.next_value).padStart(7, '0')}`}
          >
            <Segmented
              value={header.destination}
              onChange={(destination) => setHeader((h) => ({ ...h, destination }))}
              options={DESTINATIONS}
            />
          </Field>
        </div>
        {clients.data?.length === 0 && (
          <p className="muted small">
            Справочник клиентов пуст — <Link to="/clients">добавьте клиента</Link>.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Строки</h2>
        <div className="lines-scroll">
          <table className="table lines">
            <thead>
              <tr>
                <th>#</th>
                <th>Модель</th>
                <th className="num">Количество</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={line.key}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <select
                      value={line.model_id}
                      onChange={(e) => updateLine(line.key, { model_id: e.target.value })}
                      required
                      aria-label="Модель"
                    >
                      <option value="">— выберите модель —</option>
                      {models.data?.map((m) => (
                        <option
                          key={m.id}
                          value={m.id}
                          disabled={usedModels.has(m.id) && m.id !== line.model_id}
                        >
                          {m.manufacturer} {m.model}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <input
                      className="qty"
                      type="number"
                      min={1}
                      max={10000}
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      required
                      aria-label="Количество"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                      disabled={lines.length === 1}
                      aria-label="Удалить строку"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="lines-foot">
          <button
            type="button"
            className="btn ghost"
            onClick={() => setLines((ls) => [...ls, { key: Date.now(), model_id: '', quantity: '1' }])}
          >
            <Plus size={16} /> Добавить строку
          </button>
          <span>
            Всего устройств: <b>{total}</b>
          </span>
        </div>
        {models.data?.length === 0 && (
          <p className="muted small">
            В реестре нет моделей — <Link to="/devices">добавьте модель</Link>.
          </p>
        )}
      </section>

      <div className="submit-bar">
        <p className="warn">
          <TriangleAlert size={16} /> После создания состав поставки (модели и количество) изменить нельзя.
        </p>
        <button type="submit" className="btn primary" disabled={!canSubmit || create.isPending}>
          {create.isPending ? 'Создаём…' : 'Создать поставку'}
        </button>
      </div>
    </form>
  );
}
