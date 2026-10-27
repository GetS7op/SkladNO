import { z } from 'zod';
import { apiGet, apiPost, apiPut, withQuery } from '../../core/api/client';
import { type Destination, destinationSchema } from '../../core/domain';
import { formatIndex } from '../../core/ui/format';

/** F-07: шаблон контейнера. */
const containerSchema = z.object({
  id: z.string(),
  name: z.string(),
  short_name: z.string(),
  power_kw: z.number(),
  racks: z.number().int(),
  shelves_per_rack: z.number().int(),
  devices_per_shelf: z.number().int(),
  shelf_dims_mm: z.string().nullable(),
  description: z.string().nullable(),
  instances: z.number().int(),
});
export type Container = z.infer<typeof containerSchema>;
export type ContainerInput = Omit<Container, 'id' | 'instances'>;

/** F-08: модуль — набор экземпляров контейнеров. */
const moduleInstanceSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  container_id: z.string(),
  container_name: z.string(),
  short_name: z.string(),
  capacity: z.number().int(),
  placed: z.number().int(),
});
const moduleSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  /** Расположение модуля — склад. */
  warehouse: destinationSchema,
  warehouse_name: z.string(),
  containers: z.array(moduleInstanceSchema),
  capacity: z.number().int(),
  placed: z.number().int(),
});
export type Module = z.infer<typeof moduleSchema>;
export type ModuleInput = {
  number: number;
  warehouse: Destination;
  containers: { number: number; container_id: string }[];
};

/** F-09: карта — экземпляры контейнеров и занятость полок. */
const mapInstanceSchema = z.object({
  module_id: z.string(),
  module_number: z.number().int(),
  warehouse: destinationSchema,
  warehouse_name: z.string(),
  id: z.string(),
  number: z.number().int(),
  name: z.string(),
  short_name: z.string(),
  racks: z.number().int(),
  shelves_per_rack: z.number().int(),
  devices_per_shelf: z.number().int(),
  power_kw: z.number(),
  load_w: z.number().int(),
});
export type MapInstance = z.infer<typeof mapInstanceSchema>;
const mapSchema = z.object({
  instances: z.array(mapInstanceSchema),
  shelves: z.array(
    z.object({
      module_container_id: z.string(),
      rack: z.number().int(),
      shelf: z.number().int(),
      count: z.number().int(),
    }),
  ),
});
export type MapData = z.infer<typeof mapSchema>;

const shelfSchema = z.object({
  address: z.string(),
  warehouse: destinationSchema,
  capacity: z.number().int(),
  devices: z.array(
    z.object({
      device_index: z.string(),
      manufacturer: z.string(),
      model: z.string(),
      delivery_number: z.string(),
    }),
  ),
});

const placeResultSchema = z.object({
  address: z.string(),
  device_index: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  delivery_id: z.string(),
  delivery_number: z.string(),
  moved_from: z.string().nullable(),
  unchanged: z.boolean(),
  shelf_count: z.number().int(),
  shelf_capacity: z.number().int(),
});
export type PlaceResult = z.infer<typeof placeResultSchema>;

/** F-06: склад из справочника — имя, маска INDEX и сводка размещения. */
const warehouseSchema = z.object({
  code: destinationSchema,
  name: z.string(),
  index_mask: z.string(),
  first_value: z.number().int(),
  next_value: z.number().int(),
  max_value: z.number().int(),
  modules: z.number().int(),
  containers: z.number().int(),
  capacity: z.number().int(),
  power_kw: z.number(),
  devices: z.number().int(),
  placed: z.number().int(),
  load_w: z.number().int(),
});

export const listContainers = (q: string) =>
  apiGet(withQuery('/containers', { q }), z.array(containerSchema));
export const createContainer = (input: ContainerInput) => apiPost('/containers', input, containerSchema);
export const updateContainer = ({ id, input }: { id: string; input: ContainerInput }) =>
  apiPut(`/containers/${id}`, input, containerSchema);

export type ModuleListParams = { q: string; warehouse: string };
export const listModules = (params: ModuleListParams) =>
  apiGet(withQuery('/modules', params), z.array(moduleSchema));
export const createModule = (input: ModuleInput) => apiPost('/modules', input, moduleSchema);
export const updateModule = ({ id, input }: { id: string; input: ModuleInput }) =>
  apiPut(`/modules/${id}`, input, moduleSchema);

export const getMap = (warehouse: string) => apiGet(withQuery('/map', { warehouse }), mapSchema);
export const getShelf = (code: string) => apiGet(withQuery('/map/shelf', { code }), shelfSchema);
export const placeDevice = (input: { shelf: string; index: string }) =>
  apiPost('/placements', { shelf_code: input.shelf, device_index: input.index }, placeResultSchema);
export type Warehouse = z.infer<typeof warehouseSchema>;
export const listWarehouses = () => apiGet('/warehouses', z.array(warehouseSchema));
export const createWarehouse = (input: { name: string; index_mask: string }) =>
  apiPost('/warehouses', input, warehouseSchema);
export const renameWarehouse = ({ code, name }: { code: string; name: string }) =>
  apiPut(`/warehouses/${code}`, { name }, warehouseSchema);

const INDEX_DIGITS = 7;

/**
 * Диапазон INDEX по маске склада (как на сервере): 7 знаков, цифры склада и X на месте номера.
 * Кириллическая «Х» и строчные буквы допускаются. null — маска неверна.
 */
export function maskRange(raw: string): { mask: string; first: string; last: string; count: number } | null {
  const mask = raw.trim().toUpperCase().replaceAll('Х', 'X');
  const match = /^([0-9]+)(X+)$/.exec(mask);
  if (!match || mask.length !== INDEX_DIGITS) return null;
  const span = 10 ** match[2].length;
  const start = Number(match[1]) * span;
  const first = Math.max(start, 1);
  const last = start + span - 1;
  return { mask, first: formatIndex(first), last: formatIndex(last), count: last - first + 1 };
}
