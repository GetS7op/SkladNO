export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    let message = `Ошибка сервера (${response.status})`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      // ответ без JSON — оставляем общее сообщение
    }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

function query(params: Record<string, string | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export type Destination = 'park' | 'workshop';
export type Stage = 'created' | 'receiving' | 'confirmation' | 'closed';

export interface DeviceModel {
  id: string;
  manufacturer: string;
  model: string;
  hashrate_ths: number | null;
  power_w: number | null;
  dimensions_mm: string | null;
  weight_kg: string | null;
  archived: boolean;
}
export type DeviceModelInput = Omit<DeviceModel, 'id' | 'archived'>;

export interface Client {
  id: string;
  name: string;
  note: string | null;
  deliveries: number;
  devices: number;
}
export type ClientInput = Pick<Client, 'name' | 'note'>;

export interface DeliverySummary {
  id: string;
  number: string;
  client_id: string;
  client_name: string;
  device_group: string | null;
  delivery_date: string;
  basis_doc: string | null;
  basis_date: string | null;
  destination: Destination;
  stage: Stage;
  created_at: string;
  devices: number;
}

export interface DeliveryLine {
  model_id: string;
  manufacturer: string;
  model: string;
  quantity: number;
  first_index: string | null;
  last_index: string | null;
}

/** Детальная поставка: вместо счётчика устройств приходит их список. */
export type DeliveryDetail = Omit<DeliverySummary, 'devices'> & {
  lines: DeliveryLine[];
  devices: DeliveryDevice[];
};

export interface DeliveryDevice {
  id: string;
  device_index: string;
  manufacturer: string;
  model: string;
  /** Адрес полки MXCXSXP, если устройство размещено. */
  location: string | null;
}

export interface CreateDeliveryInput {
  request_id: string;
  client_id: string;
  device_group: string | null;
  delivery_date: string;
  basis_doc: string | null;
  basis_date: string | null;
  destination: Destination;
  lines: { model_id: string; quantity: number }[];
}

export interface IndexRange {
  destination: Destination;
  next_value: number;
  max_value: number;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  entity: string;
  entity_id: string | null;
  action: string;
  changes: Record<string, unknown>;
}

export interface Pool {
  id: string;
  name: string;
  stratum1: string;
  stratum2: string | null;
  stratum3: string | null;
  allowed: boolean;
  archived: boolean;
  workers: number;
}
export interface PoolInput {
  name: string;
  strata: string[];
  allowed: boolean;
}

export interface Worker {
  id: string;
  pool_id: string;
  pool_name: string;
  name: string;
  group_name: string | null;
  watcher_url: string | null;
  archived: boolean;
}
export type WorkerInput = Pick<Worker, 'pool_id' | 'name' | 'group_name' | 'watcher_url'>;

export interface Container {
  id: string;
  name: string;
  short_name: string;
  power_kw: number;
  racks: number;
  shelves_per_rack: number;
  devices_per_shelf: number;
  shelf_dims_mm: string | null;
  description: string | null;
  instances: number;
}
export type ContainerInput = Omit<Container, 'id' | 'instances'>;

export interface ModuleInstance {
  id: string;
  number: number;
  container_id: string;
  container_name: string;
  short_name: string;
  capacity: number;
  placed: number;
}
export interface Module {
  id: string;
  number: number;
  location: string | null;
  warehouse: Destination;
  containers: ModuleInstance[];
  capacity: number;
  placed: number;
}
export interface ModuleInput {
  number: number;
  location: string | null;
  warehouse: Destination;
  containers: { number: number; container_id: string }[];
}

export interface MapInstance {
  module_id: string;
  module_number: number;
  location: string | null;
  warehouse: Destination;
  id: string;
  number: number;
  name: string;
  short_name: string;
  racks: number;
  shelves_per_rack: number;
  devices_per_shelf: number;
  power_kw: number;
  load_w: number;
}
export interface MapData {
  instances: MapInstance[];
  shelves: { module_container_id: string; rack: number; shelf: number; count: number }[];
}
export interface ShelfInfo {
  address: string;
  warehouse: Destination;
  capacity: number;
  devices: { device_index: string; manufacturer: string; model: string; delivery_number: string }[];
}
export interface PlaceResult {
  address: string;
  device_index: string;
  manufacturer: string;
  model: string;
  delivery_id: string;
  delivery_number: string;
  moved_from: string | null;
  unchanged: boolean;
  shelf_count: number;
  shelf_capacity: number;
}
export interface WarehouseSummary {
  warehouse: Destination;
  modules: number;
  containers: number;
  capacity: number;
  power_kw: number;
  devices: number;
  placed: number;
  load_w: number;
}

export const api = {
  pools: {
    list: (q: string, archived: boolean) =>
      request<Pool[]>(`/pools${query({ q, archived: archived || undefined })}`),
    create: (input: PoolInput) => post<Pool>('/pools', input),
    update: (id: string, input: PoolInput) => put<Pool>(`/pools/${id}`, input),
    archive: (id: string) => post<Pool>(`/pools/${id}/archive`),
    restore: (id: string) => post<Pool>(`/pools/${id}/restore`),
  },
  workers: {
    list: (q: string, archived: boolean) =>
      request<Worker[]>(`/workers${query({ q, archived: archived || undefined })}`),
    groups: () => request<string[]>('/workers/groups'),
    create: (input: WorkerInput) => post<Worker>('/workers', input),
    update: (id: string, input: WorkerInput) => put<Worker>(`/workers/${id}`, input),
    archive: (id: string) => post<Worker>(`/workers/${id}/archive`),
    restore: (id: string) => post<Worker>(`/workers/${id}/restore`),
  },
  containers: {
    list: (q: string) => request<Container[]>(`/containers${query({ q })}`),
    create: (input: ContainerInput) => post<Container>('/containers', input),
    update: (id: string, input: ContainerInput) => put<Container>(`/containers/${id}`, input),
  },
  modules: {
    list: (q: string, warehouse: string) => request<Module[]>(`/modules${query({ q, warehouse })}`),
    locations: () => request<string[]>('/modules/locations'),
    create: (input: ModuleInput) => post<Module>('/modules', input),
    update: (id: string, input: ModuleInput) => put<Module>(`/modules/${id}`, input),
  },
  map: {
    get: (warehouse: string) => request<MapData>(`/map${query({ warehouse })}`),
    shelf: (code: string) => request<ShelfInfo>(`/map/shelf${query({ code })}`),
    place: (shelf_code: string, device_index: string) =>
      post<PlaceResult>('/placements', { shelf_code, device_index }),
    warehouses: () => request<WarehouseSummary[]>('/warehouses'),
  },
  devices: {
    list: (q: string, archived: boolean) =>
      request<DeviceModel[]>(`/devices${query({ q, archived: archived || undefined })}`),
    manufacturers: () => request<string[]>('/devices/manufacturers'),
    create: (input: DeviceModelInput) => post<DeviceModel>('/devices', input),
    update: (id: string, input: DeviceModelInput) => put<DeviceModel>(`/devices/${id}`, input),
    archive: (id: string) => post<DeviceModel>(`/devices/${id}/archive`),
    restore: (id: string) => post<DeviceModel>(`/devices/${id}/restore`),
  },
  clients: {
    list: (q: string) => request<Client[]>(`/clients${query({ q })}`),
    create: (input: ClientInput) => post<Client>('/clients', input),
    update: (id: string, input: ClientInput) => put<Client>(`/clients/${id}`, input),
    exportUrl: (id: string) => `/api/v1/clients/${id}/devices.csv`,
  },
  deliveries: {
    list: (q: string, stage: string) => request<DeliverySummary[]>(`/deliveries${query({ q, stage })}`),
    get: (id: string) => request<DeliveryDetail>(`/deliveries/${id}`),
    create: (input: CreateDeliveryInput) => post<DeliveryDetail>('/deliveries', input),
    advance: (id: string, expected_stage: Stage) =>
      post<DeliveryDetail>(`/deliveries/${id}/advance`, { expected_stage }),
    groups: () => request<string[]>('/deliveries/groups'),
    indexRanges: () => request<IndexRange[]>('/deliveries/index-ranges'),
  },
  audit: {
    list: (entity?: string, entity_id?: string) =>
      request<AuditEntry[]>(`/audit${query({ entity, entity_id })}`),
  },
};
