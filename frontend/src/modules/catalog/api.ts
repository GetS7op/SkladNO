import { z } from 'zod';
import { apiGet, apiPost, apiPut, withQuery } from '../../core/api/client';

/** F-01: модель устройства «Производитель + Модель» и её характеристики. */
const deviceModelSchema = z.object({
  id: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  hashrate_ths: z.number().nullable(),
  power_w: z.number().int().nullable(),
  dimensions_mm: z.string().nullable(),
  weight_kg: z.string().nullable(),
  archived: z.boolean(),
});

export type DeviceModel = z.infer<typeof deviceModelSchema>;
export type DeviceModelInput = Omit<DeviceModel, 'id' | 'archived'>;

export type DeviceModelListParams = { q: string; archived: boolean };

export const listDeviceModels = (params: DeviceModelListParams) =>
  apiGet(withQuery('/devices', params), z.array(deviceModelSchema));

export const listManufacturers = () => apiGet('/devices/manufacturers', z.array(z.string()));

export const createDeviceModel = (input: DeviceModelInput) => apiPost('/devices', input, deviceModelSchema);

export const updateDeviceModel = ({ id, input }: { id: string; input: DeviceModelInput }) =>
  apiPut(`/devices/${id}`, input, deviceModelSchema);

export const setDeviceModelArchived = ({ id, archived }: { id: string; archived: boolean }) =>
  apiPost(`/devices/${id}/${archived ? 'archive' : 'restore'}`, {}, deviceModelSchema);
