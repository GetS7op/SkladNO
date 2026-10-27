import { z } from 'zod';
import { apiGet, apiPut } from '../../core/api/client';

/** D-06: разделитель в адресе места MXCXSXP (по умолчанию «X»). */
const settingsSchema = z.object({
  address_separator: z.string(),
  allowed_separators: z.array(z.string()),
});
export type Settings = z.infer<typeof settingsSchema>;

export const getSettings = () => apiGet('/settings', settingsSchema);

export const updateSettings = (input: { address_separator: string }) =>
  apiPut('/settings', input, settingsSchema);

/** Адрес полки с текущим разделителем: 1X2X3X4. */
export const formatAddress = (separator: string, ...parts: number[]) => parts.join(separator);
