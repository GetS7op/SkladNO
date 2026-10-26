import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, ScanLine } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, type PlaceResult } from '../api';

interface LogEntry {
  id: number;
  ok: boolean;
  text: string;
}

/**
 * F-09 / F-03 шаг 3: размещение сканированием. Сначала штрихкод полки, затем INDEX устройств —
 * полка запоминается, и можно сканировать устройства подряд. Сканер работает как клавиатура с Enter.
 */
export function ScanPanel({ hint }: { hint?: string }) {
  const queryClient = useQueryClient();
  const [shelf, setShelf] = useState('');
  const [index, setIndex] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const shelfRef = useRef<HTMLInputElement>(null);
  const indexRef = useRef<HTMLInputElement>(null);

  const push = (ok: boolean, text: string) =>
    setLog((l) => [{ id: Date.now() + Math.random(), ok, text }, ...l].slice(0, 20));

  const place = useMutation({
    mutationFn: (vars: { shelf: string; index: string }) => api.map.place(vars.shelf, vars.index),
    onSuccess: (r: PlaceResult) => {
      const where = r.unchanged
        ? `уже на полке ${r.address}`
        : r.moved_from
          ? `перенесено ${r.moved_from} → ${r.address}`
          : `размещено на ${r.address}`;
      push(true, `${r.device_index} ${r.model}: ${where} (${r.shelf_count}/${r.shelf_capacity})`);
      for (const key of ['delivery', 'map', 'modules', 'warehouses', 'audit']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e: Error, vars) => push(false, `${vars.index} → ${vars.shelf}: ${e.message}`),
  });

  // Поле INDEX очищается сразу при отправке: сканер вводит следующий код, не дожидаясь ответа сервера.
  const submit = () => {
    if (!shelf.trim()) return shelfRef.current?.focus();
    if (index.trim()) place.mutate({ shelf: shelf.trim(), index: index.trim() });
    setIndex('');
    indexRef.current?.focus();
  };

  return (
    <section className="card scan">
      <div className="card-head">
        <h2>
          <ScanLine size={18} /> Приём сканированием
        </h2>
      </div>
      {hint && <p className="muted small">{hint}</p>}
      <form
        className="scan-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span className="field-label">1. Штрихкод полки</span>
          <input
            ref={shelfRef}
            className="mono"
            value={shelf}
            onChange={(e) => setShelf(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                indexRef.current?.focus();
              }
            }}
            placeholder="1X2X3X4"
          />
        </label>
        <label className="field">
          <span className="field-label">2. INDEX устройства</span>
          <input
            ref={indexRef}
            className="mono"
            value={index}
            onChange={(e) => setIndex(e.target.value)}
            placeholder="0000001"
            inputMode="numeric"
          />
        </label>
        <div className="scan-actions">
          <button
            type="submit"
            className="btn primary"
            disabled={!shelf.trim() || !index.trim()}
          >
            Разместить
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setShelf('');
              shelfRef.current?.focus();
            }}
          >
            Другая полка
          </button>
        </div>
      </form>
      {log.length > 0 && (
        <ul className="scan-log">
          {log.map((entry) => (
            <li key={entry.id} className={entry.ok ? 'ok' : 'fail'}>
              {entry.ok ? <CircleCheck size={16} /> : <CircleX size={16} />}
              {entry.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
