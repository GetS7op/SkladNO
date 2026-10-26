import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, isNetworkError } from '../../core/api/client';
import { type PlaceResult, placeDevice } from './api';

/**
 * Офлайн-очередь ТСД: сканы без связи сохраняются на устройстве и отправляются, когда связь вернётся.
 * Сервер принимает повторный скан без изменений, поэтому повторная отправка безопасна.
 * Скан, который сервер отклонил (полка заполнена, чужой склад…), уходит в список для ручного разбора.
 */
export interface QueuedScan {
  id: string;
  shelf: string;
  index: string;
  scannedAt: string;
}

export interface RejectedScan extends QueuedScan {
  reason: string;
}

const QUEUE_KEY = 'skladno.scanQueue';
const REJECTED_KEY = 'skladno.scanRejected';
const RETRY_MS = 15_000;

function load<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}

function save<T>(key: string, items: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // хранилище недоступно (приватный режим) — очередь живёт до перезагрузки страницы
  }
}

export type ScanOutcome =
  { kind: 'placed'; result: PlaceResult } | { kind: 'queued' } | { kind: 'rejected'; reason: string };

export function useScanQueue(onPlaced: (result: PlaceResult) => void) {
  const [queue, setQueue] = useState<QueuedScan[]>(() => load(QUEUE_KEY));
  const [rejected, setRejected] = useState<RejectedScan[]>(() => load(REJECTED_KEY));
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);
  const onPlacedRef = useRef(onPlaced);
  useEffect(() => {
    onPlacedRef.current = onPlaced;
  });

  const updateQueue = useCallback((fn: (q: QueuedScan[]) => QueuedScan[]) => {
    setQueue((q) => {
      const next = fn(q);
      save(QUEUE_KEY, next);
      return next;
    });
  }, []);
  const updateRejected = useCallback((fn: (r: RejectedScan[]) => RejectedScan[]) => {
    setRejected((r) => {
      const next = fn(r);
      save(REJECTED_KEY, next);
      return next;
    });
  }, []);

  /** Отправляет очередь по порядку. Останавливается при отсутствии связи, входа или сбое сервера. */
  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      for (const scan of load<QueuedScan>(QUEUE_KEY)) {
        try {
          const result = await placeDevice({ shelf: scan.shelf, index: scan.index });
          onPlacedRef.current(result);
        } catch (error) {
          if (isNetworkError(error)) break;
          const status = (error as ApiError).status;
          if (status === 401 || status >= 500) break;
          updateRejected((r) => [{ ...scan, reason: (error as Error).message }, ...r]);
        }
        updateQueue((q) => q.filter((s) => s.id !== scan.id));
      }
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [updateQueue, updateRejected]);

  useEffect(() => {
    if (queue.length === 0) return;
    window.addEventListener('online', sync);
    const timer = setInterval(sync, RETRY_MS);
    return () => {
      window.removeEventListener('online', sync);
      clearInterval(timer);
    };
  }, [queue.length, sync]);

  /** Скан: сразу на сервер; без связи — в очередь. Пока очередь не пуста, новые сканы встают за ней. */
  const scan = useCallback(
    async (shelf: string, index: string): Promise<ScanOutcome> => {
      const item: QueuedScan = {
        id: `${Date.now()}-${Math.random()}`,
        shelf,
        index,
        scannedAt: new Date().toISOString(),
      };
      if (load<QueuedScan>(QUEUE_KEY).length > 0 || !navigator.onLine) {
        updateQueue((q) => [...q, item]);
        return { kind: 'queued' };
      }
      try {
        const result = await placeDevice({ shelf, index });
        return { kind: 'placed', result };
      } catch (error) {
        if (isNetworkError(error)) {
          updateQueue((q) => [...q, item]);
          return { kind: 'queued' };
        }
        return { kind: 'rejected', reason: (error as Error).message };
      }
    },
    [updateQueue],
  );

  const dismiss = useCallback(
    (id: string) => updateRejected((r) => r.filter((s) => s.id !== id)),
    [updateRejected],
  );

  return { queue, rejected, syncing, scan, sync, dismiss };
}
