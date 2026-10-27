import { z } from 'zod';
import { apiGet, apiPost, apiPostEmpty, apiPut, withQuery } from '../../core/api/client';

/** Статусы устройств: категории, статусы и матрица разрешённых переходов «из → в». */
const statusesSchema = z.object({
  categories: z.array(z.object({ id: z.string(), name: z.string(), note: z.string().nullable() })),
  statuses: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category_id: z.string().nullable(),
      category_name: z.string().nullable(),
      note: z.string().nullable(),
      devices: z.number().int(),
    }),
  ),
  transitions: z.array(z.tuple([z.string(), z.string()])),
});
export type StatusesOverview = z.infer<typeof statusesSchema>;
export type DeviceStatusRow = StatusesOverview['statuses'][number];
export type StatusInput = { name: string; category_id: string | null; note: string | null };

export const getStatuses = () => apiGet('/statuses', statusesSchema);
export const createStatus = (input: StatusInput) => apiPost('/statuses', input, statusesSchema);
export const updateStatus = ({ id, input }: { id: string; input: StatusInput }) =>
  apiPut(`/statuses/${id}`, input, statusesSchema);
export const createCategory = (input: { name: string; note: string | null }) =>
  apiPost('/status-categories', input, statusesSchema);
export const updateCategory = ({ id, input }: { id: string; input: { name: string; note: string | null } }) =>
  apiPut(`/status-categories/${id}`, input, statusesSchema);
export const saveTransitions = (pairs: [string, string][]) =>
  apiPut('/status-transitions', { pairs }, statusesSchema);

const deviceStatusSchema = z.object({
  status_id: z.string().nullable(),
  status_name: z.string().nullable(),
  outside_matrix: z.boolean(),
});
export const setDeviceStatus = ({ deviceId, statusId }: { deviceId: string; statusId: string | null }) =>
  apiPut(`/inventory/${deviceId}/status`, { status_id: statusId }, deviceStatusSchema);

/** Отправка устройства контрагенту: открыта, пока нет даты прибытия. */
const shipmentSchema = z.object({
  id: z.string(),
  device_id: z.string(),
  device_index: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  client_name: z.string(),
  recipient: z.string().nullable(),
  packed_at: z.string().nullable(),
  shipped_at: z.string().nullable(),
  arrived_at: z.string().nullable(),
  comment: z.string().nullable(),
  repair_note: z.string().nullable(),
  status_name: z.string().nullable(),
  created_at: z.string(),
  created_by: z.string(),
});
export type Shipment = z.infer<typeof shipmentSchema>;
export type ShipmentFields = {
  recipient: string | null;
  packed_at: string | null;
  shipped_at: string | null;
  arrived_at: string | null;
  comment: string | null;
  repair_note: string | null;
};
export type ShipmentParams = { q: string; open: boolean; device_id?: string };

export const listShipments = (params: ShipmentParams) =>
  apiGet(withQuery('/shipments', params), z.array(shipmentSchema));
export const getShipmentStats = () =>
  apiGet('/shipments/stats', z.object({ total: z.number().int(), open: z.number().int() }));
export const listRecipients = () => apiGet('/shipments/recipients', z.array(z.string()));
export const createShipments = (input: ShipmentFields & { devices: string }) =>
  apiPost(
    '/shipments',
    input,
    z.object({
      created: z.array(z.string()),
      blocked: z.array(z.object({ device_index: z.string(), reason: z.string() })),
      missing_status: z.string().nullable(),
    }),
  );
export const updateShipment = ({ id, input }: { id: string; input: ShipmentFields }) =>
  apiPut(
    `/shipments/${id}`,
    input,
    z.object({ shipment: shipmentSchema, missing_status: z.string().nullable() }),
  );

/** Склад комплектующих: остаток = приход − установлено + снято − списано. */
const partSchema = z.object({
  id: z.string(),
  name: z.string(),
  part_type_id: z.string().nullable(),
  type_name: z.string().nullable(),
  note: z.string().nullable(),
  received: z.number().int(),
  installed: z.number().int(),
  removed: z.number().int(),
  written_off: z.number().int(),
  available: z.number().int(),
});
export type Part = z.infer<typeof partSchema>;
export type PartInput = { name: string; part_type_id: string | null; note: string | null };

const receiptSchema = z.object({
  id: z.string(),
  received_at: z.string(),
  supplier: z.string().nullable(),
  document: z.string().nullable(),
  note: z.string().nullable(),
  created_by: z.string(),
  lines: z.string(),
  quantity: z.number().int(),
});
export type Receipt = z.infer<typeof receiptSchema>;

export const movementActionSchema = z.enum(['installed', 'removed', 'written_off']);
export type MovementAction = z.infer<typeof movementActionSchema>;
export const MOVEMENT_ACTIONS: { value: MovementAction; label: string }[] = [
  { value: 'installed', label: 'Установить в устройство' },
  { value: 'removed', label: 'Снять с устройства' },
  { value: 'written_off', label: 'Списать' },
];
export const movementLabel = (action: MovementAction) =>
  ({ installed: 'установлено', removed: 'снято', written_off: 'списано' })[action];

const movementSchema = z.object({
  id: z.string(),
  part_id: z.string(),
  part_name: z.string(),
  action: movementActionSchema,
  quantity: z.number().int(),
  device_id: z.string().nullable(),
  device_index: z.string().nullable(),
  note: z.string().nullable(),
  at: z.string(),
  actor: z.string(),
});
export type Movement = z.infer<typeof movementSchema>;

export const listParts = () => apiGet('/parts', z.array(partSchema));
export const createPart = (input: PartInput) => apiPost('/parts', input, partSchema);
export const updatePart = ({ id, input }: { id: string; input: PartInput }) =>
  apiPut(`/parts/${id}`, input, partSchema);
export const listPartTypes = () =>
  apiGet('/part-types', z.array(z.object({ id: z.string(), name: z.string() })));
export const createPartType = (name: string) =>
  apiPost('/part-types', { name }, z.object({ id: z.string(), name: z.string() }));
export const listReceipts = () => apiGet('/part-receipts', z.array(receiptSchema));
export const createReceipt = (input: {
  received_at: string;
  supplier: string | null;
  document: string | null;
  note: string | null;
  lines: { part_id: string; quantity: number }[];
}) => apiPostEmpty('/part-receipts', input);
export const listMovements = (params: { part_id?: string; device_id?: string }) =>
  apiGet(withQuery('/part-movements', params), z.array(movementSchema));
export const createMovement = (input: {
  part_id: string;
  action: MovementAction;
  quantity: number;
  device_index: string | null;
  note: string | null;
}) => apiPost('/part-movements', input, partSchema);
