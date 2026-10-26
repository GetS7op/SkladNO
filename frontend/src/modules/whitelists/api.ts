import { z } from 'zod';
import { apiGet, apiPost, apiPut, withQuery } from '../../core/api/client';

/** F-04: пул и стратум-ссылки (1–3). */
const poolSchema = z.object({
  id: z.string(),
  name: z.string(),
  stratum1: z.string(),
  stratum2: z.string().nullable(),
  stratum3: z.string().nullable(),
  allowed: z.boolean(),
  archived: z.boolean(),
  workers: z.number().int(),
});
export type Pool = z.infer<typeof poolSchema>;
export type PoolInput = { name: string; strata: string[]; allowed: boolean };

/** F-05: воркер; уникален в рамках пула. «Онлайн» и «XP» — будущая итерация (D-10). */
const workerSchema = z.object({
  id: z.string(),
  pool_id: z.string(),
  pool_name: z.string(),
  name: z.string(),
  group_name: z.string().nullable(),
  watcher_url: z.string().nullable(),
  archived: z.boolean(),
});
export type Worker = z.infer<typeof workerSchema>;
export type WorkerInput = Pick<Worker, 'pool_id' | 'name' | 'group_name' | 'watcher_url'>;

export type WhitelistParams = { q: string; archived: boolean };

export const listPools = (params: WhitelistParams) =>
  apiGet(withQuery('/pools', params), z.array(poolSchema));
export const createPool = (input: PoolInput) => apiPost('/pools', input, poolSchema);
export const updatePool = ({ id, input }: { id: string; input: PoolInput }) =>
  apiPut(`/pools/${id}`, input, poolSchema);
export const setPoolArchived = ({ id, archived }: { id: string; archived: boolean }) =>
  apiPost(`/pools/${id}/${archived ? 'archive' : 'restore'}`, {}, poolSchema);

export const listWorkers = (params: WhitelistParams) =>
  apiGet(withQuery('/workers', params), z.array(workerSchema));
export const listWorkerGroups = () => apiGet('/workers/groups', z.array(z.string()));
export const createWorker = (input: WorkerInput) => apiPost('/workers', input, workerSchema);
export const updateWorker = ({ id, input }: { id: string; input: WorkerInput }) =>
  apiPut(`/workers/${id}`, input, workerSchema);
export const setWorkerArchived = ({ id, archived }: { id: string; archived: boolean }) =>
  apiPost(`/workers/${id}/${archived ? 'archive' : 'restore'}`, {}, workerSchema);
