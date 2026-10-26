import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, CloudOff, RefreshCw, ScanLine, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { PlaceResult } from '../api';
import { formatDateTime } from '../format';
import { useScanQueue } from '../scanQueue';

interface LogEntry {
  id: number;
  kind: 'ok' | 'fail' | 'queued';
  text: string;
}

const describe = (r: PlaceResult) => {
  const where = r.unchanged
    ? `уже на полке ${r.address}`
    : r.moved_from
      ? `перенесено ${r.moved_from} → ${r.address}`
      : `размещено на ${r.address}`;
  return `${r.device_index} ${r.model}: ${where} (${r.shelf_count}/${r.shelf_capacity})`;
};

/**
 * F-09 / F-03 шаг 3: размещение сканированием. Сначала штрихкод полки, затем INDEX устройств —
 * полка запоминается, и можно сканировать устройства подряд. Сканер работает как клавиатура с Enter.
 * Без связи сканы копятся в очереди на устройстве и отправляются автоматически.
 */
export function ScanPanel({ hint }: { hint?: string }) {
  const queryClient = useQueryClient();
  const [shelf, setShelf] = useState('');
  const [index, setIndex] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const shelfRef = useRef<HTMLInputElement>(null);
  const indexRef = useRef<HTMLInputElement>(null);

  const push = (kind: LogEntry['kind'], text: string) =>
    setLog((l) => [{ id: Date.now() + Math.random(), kind, text }, ...l].slice(0, 20));
  const refresh = () => {
    for (const key of ['delivery', 'map', 'modules', 'warehouses', 'audit']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
  const queue = useScanQueue((result) => {
    push('ok', `из очереди: ${describe(result)}`);
    refresh();
  });

  // Поле INDEX очищается сразу при отправке: сканер вводит следующий код, не дожидаясь ответа сервера.
  const submit = async () => {
    if (!shelf.trim()) return shelfRef.current?.focus();
    const target = { shelf: shelf.trim(), index: index.trim() };
    setIndex('');
    indexRef.current?.focus();
    if (!target.index) return;
    const outcome = await queue.scan(target.shelf, target.index);
    if (outcome.kind === 'placed') {
      push('ok', describe(outcome.result));
      refresh();
    } else if (outcome.kind === 'queued') {
      push('queued', `${target.index} → ${target.shelf}: нет связи, скан сохранён в очереди`);
    } else {
      push('fail', `${target.index} → ${target.shelf}: ${outcome.reason}`);
    }
  };

  return (
    <section className="card scan">
      <div className="card-head">
        <h2>
          <ScanLine size={18} /> Приём сканированием
        </h2>
        {queue.queue.length > 0 && (
          <span className="queue-badge">
            <CloudOff size={14} /> В очереди: {queue.queue.length}
            <button type="button" className="btn ghost" onClick={queue.sync} disabled={queue.syncing}>
              <RefreshCw size={14} /> {queue.syncing ? 'Отправка…' : 'Отправить'}
            </button>
          </span>
        )}
      </div>
      {hint && <p className="muted small">{hint}</p>}
      <form
        className="scan-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
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
          <button type="submit" className="btn primary" disabled={!shelf.trim() || !index.trim()}>
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
            <li key={entry.id} className={entry.kind}>
              {entry.kind === 'ok' ? (
                <CircleCheck size={16} />
              ) : entry.kind === 'queued' ? (
                <CloudOff size={16} />
              ) : (
                <CircleX size={16} />
              )}
              {entry.text}
            </li>
          ))}
        </ul>
      )}
      {queue.rejected.length > 0 && (
        <div className="rejected">
          <h3>Отклонено при синхронизации — разберите вручную ({queue.rejected.length})</h3>
          <ul className="scan-log">
            {queue.rejected.map((r) => (
              <li key={r.id} className="fail">
                <CircleX size={16} />
                <span>
                  <b className="mono">
                    {r.index} → {r.shelf}
                  </b>{' '}
                  (скан {formatDateTime(r.scannedAt)}): {r.reason}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Убрать из списка"
                  onClick={() => queue.dismiss(r.id)}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
