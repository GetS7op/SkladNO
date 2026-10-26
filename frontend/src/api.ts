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

export const api = {
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
