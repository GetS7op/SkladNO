import { z } from 'zod';
import { apiGet, apiPost, apiPut, apiUrl, withQuery } from '../../core/api/client';

/** F-02: клиент со счётчиками поставок и устройств (по всем поставкам). */
const clientSchema = z.object({
  id: z.string(),
  name: z.string(),
  note: z.string().nullable(),
  deliveries: z.number().int(),
  devices: z.number().int(),
});

export type Client = z.infer<typeof clientSchema>;
export type ClientInput = Pick<Client, 'name' | 'note'>;

export const listClients = (q: string) => apiGet(withQuery('/clients', { q }), z.array(clientSchema));

export const createClient = (input: ClientInput) => apiPost('/clients', input, clientSchema);

export const updateClient = ({ id, input }: { id: string; input: ClientInput }) =>
  apiPut(`/clients/${id}`, input, clientSchema);

/** Результат F-02: выгрузка устройств клиента в CSV. */
export const clientDevicesCsvUrl = (id: string) => apiUrl(`/clients/${id}/devices.csv`);
