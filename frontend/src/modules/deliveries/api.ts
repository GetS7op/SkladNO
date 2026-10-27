import { z } from 'zod';
import { apiGet, apiPost, apiPut, apiUpload, apiUrl, withQuery } from '../../core/api/client';
import { importReportSchema } from '../reports/api';
import {
  type Condition,
  conditionSchema,
  type Destination,
  destinationSchema,
  type Stage,
  stageSchema,
} from '../../core/domain';

const summaryFields = {
  id: z.string(),
  number: z.string(),
  client_id: z.string(),
  client_name: z.string(),
  device_group: z.string().nullable(),
  delivery_date: z.string(),
  basis_doc: z.string().nullable(),
  basis_date: z.string().nullable(),
  destination: destinationSchema,
  stage: stageSchema,
  /** null — у поставок, созданных до появления поля. */
  condition: conditionSchema.nullable(),
  customs: z.boolean(),
  created_at: z.string(),
};

const deliverySummarySchema = z.object({ ...summaryFields, devices: z.number().int() });
export type DeliverySummary = z.infer<typeof deliverySummarySchema>;

const deliveryDeviceSchema = z.object({
  id: z.string(),
  device_index: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  /** Адрес полки MXCXSXP, если устройство размещено. */
  location: z.string().nullable(),
  mac_address: z.string().nullable(),
  serial_no: z.string().nullable(),
});
export type DeliveryDevice = z.infer<typeof deliveryDeviceSchema>;

const deliveryLineSchema = z.object({
  model_id: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  quantity: z.number().int(),
  first_index: z.string().nullable(),
  last_index: z.string().nullable(),
});

/** Детальная поставка: вместо счётчика устройств приходит их список. */
const deliveryDetailSchema = z.object({
  ...summaryFields,
  lines: z.array(deliveryLineSchema),
  devices: z.array(deliveryDeviceSchema),
});
export type DeliveryDetail = z.infer<typeof deliveryDetailSchema>;

const indexRangeSchema = z.object({
  destination: destinationSchema,
  next_value: z.number().int(),
  max_value: z.number().int(),
});

const deliveryFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  content_type: z.string(),
  size: z.number().int(),
  uploaded_by: z.string(),
  uploaded_at: z.string(),
});
export type DeliveryFile = z.infer<typeof deliveryFileSchema>;

export type CreateDeliveryInput = {
  request_id: string;
  client_id: string;
  device_group: string | null;
  delivery_date: string;
  basis_doc: string | null;
  basis_date: string | null;
  destination: Destination;
  condition: Condition;
  lines: { model_id: string; quantity: number }[];
};

export type DeliveryListParams = { q: string; stage: string };

export const listDeliveries = (params: DeliveryListParams) =>
  apiGet(withQuery('/deliveries', params), z.array(deliverySummarySchema));

export const getDelivery = (id: string) => apiGet(`/deliveries/${id}`, deliveryDetailSchema);

export const createDelivery = (input: CreateDeliveryInput) =>
  apiPost('/deliveries', input, deliveryDetailSchema);

export const advanceDelivery = ({ id, expectedStage }: { id: string; expectedStage: Stage }) =>
  apiPost(`/deliveries/${id}/advance`, { expected_stage: expectedStage }, deliveryDetailSchema);

/** Замечания перед подтверждением и закрытием (не блокируют этап). */
export const getDeliveryWarnings = (id: string) =>
  apiGet(`/deliveries/${id}/warnings`, z.object({ warnings: z.array(z.string()) }));

export const listDeliveryGroups = () => apiGet('/deliveries/groups', z.array(z.string()));

export const listIndexRanges = () => apiGet('/deliveries/index-ranges', z.array(indexRangeSchema));

export const listDeliveryFiles = (id: string) =>
  apiGet(`/deliveries/${id}/files`, z.array(deliveryFileSchema));

export const uploadDeliveryFile = ({ id, file }: { id: string; file: File }) =>
  apiUpload(withQuery(`/deliveries/${id}/files`, { name: file.name }), file, deliveryFileSchema);

export const deliveryFileUrl = (fileId: string) => apiUrl(`/files/${fileId}`);

/** Шаблон поставки: устройства с колонками MAC и серийного номера. */
export const deliveryTemplateUrl = (id: string, format: 'xlsx' | 'csv') =>
  apiUrl(withQuery(`/deliveries/${id}/template`, { format }));

/** Загрузка заполненного шаблона; `created` — устройства с изменёнными данными. */
export const importDeviceData = ({ id, file, dryRun }: { id: string; file: File; dryRun: boolean }) =>
  apiUpload(withQuery(`/deliveries/${id}/devices/import`, { dry_run: dryRun }), file, importReportSchema);

/** Реестр INDEX: устройство из любой поставки. */
const inventoryItemSchema = z.object({
  id: z.string(),
  device_index: z.string(),
  mac_address: z.string().nullable(),
  serial_no: z.string().nullable(),
  destination: destinationSchema,
  manufacturer: z.string(),
  model: z.string(),
  hashrate_ths: z.number().nullable(),
  power_w: z.number().int().nullable(),
  client_name: z.string(),
  delivery_id: z.string(),
  delivery_number: z.string(),
  delivery_date: z.string(),
  stage: stageSchema,
  location: z.string().nullable(),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

const inventoryPageSchema = z.object({
  items: z.array(inventoryItemSchema),
  total: z.number().int(),
  offset: z.number().int(),
  limit: z.number().int(),
});

/** Карточка устройства: данные и история изменений (когда, кто, было → стало). */
const deviceCardSchema = inventoryItemSchema.extend({
  created_at: z.string(),
  history: z.array(
    z.object({
      at: z.string(),
      actor: z.string(),
      action: z.string(),
      changes: z.record(z.string(), z.unknown()),
    }),
  ),
});
export type DeviceCard = z.infer<typeof deviceCardSchema>;

export type InventoryParams = { q: string; destination: string; placement: string };

export const INVENTORY_PAGE = 100;

export const listInventory = (params: InventoryParams, offset: number) =>
  apiGet(withQuery('/inventory', { ...params, offset, limit: INVENTORY_PAGE }), inventoryPageSchema);

export const getDevice = (id: string) => apiGet(`/inventory/${id}`, deviceCardSchema);

export const updateDevice = ({
  id,
  mac_address,
  serial_no,
}: {
  id: string;
  mac_address: string | null;
  serial_no: string | null;
}) => apiPut(`/inventory/${id}`, { mac_address, serial_no }, deviceCardSchema);
