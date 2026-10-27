import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCategory,
  createMovement,
  createPart,
  createPartType,
  createReceipt,
  createShipments,
  createStatus,
  getShipmentStats,
  getStatuses,
  listMovements,
  listPartTypes,
  listParts,
  listReceipts,
  listRecipients,
  listShipments,
  saveTransitions,
  setDeviceStatus,
  type ShipmentParams,
  updateCategory,
  updatePart,
  updateShipment,
  updateStatus,
} from './api';

export const serviceKeys = {
  statuses: ['statuses'] as const,
  shipments: (params: ShipmentParams) => ['shipments', params] as const,
  shipmentStats: ['shipments', 'stats'] as const,
  recipients: ['shipments', 'recipients'] as const,
  parts: ['parts'] as const,
  partTypes: ['parts', 'types'] as const,
  receipts: ['parts', 'receipts'] as const,
  movements: (params: { part_id?: string; device_id?: string }) => ['parts', 'movements', params] as const,
};

export const useStatuses = () =>
  useQuery({ queryKey: serviceKeys.statuses, queryFn: getStatuses, staleTime: 60_000 });

/** Изменения, после которых устаревают реестр устройств, карточки и журнал. */
function useServiceMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  keys: unknown[][],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess() {
      for (const key of [...keys, ['deliveries'], ['audit']]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

const STATUS_KEYS = [['statuses']];
export const useCreateStatus = () => useServiceMutation(createStatus, STATUS_KEYS);
export const useUpdateStatus = () => useServiceMutation(updateStatus, STATUS_KEYS);
export const useCreateCategory = () => useServiceMutation(createCategory, STATUS_KEYS);
export const useUpdateCategory = () => useServiceMutation(updateCategory, STATUS_KEYS);
export const useSaveTransitions = () => useServiceMutation(saveTransitions, STATUS_KEYS);
export const useSetDeviceStatus = () => useServiceMutation(setDeviceStatus, STATUS_KEYS);

export const useShipments = (params: ShipmentParams) =>
  useQuery({
    queryKey: serviceKeys.shipments(params),
    queryFn: () => listShipments(params),
    placeholderData: (previous) => previous,
  });
export const useShipmentStats = () =>
  useQuery({ queryKey: serviceKeys.shipmentStats, queryFn: getShipmentStats });
export const useRecipients = () => useQuery({ queryKey: serviceKeys.recipients, queryFn: listRecipients });
const SHIPMENT_KEYS = [['shipments'], ['statuses']];
export const useCreateShipments = () => useServiceMutation(createShipments, SHIPMENT_KEYS);
export const useUpdateShipment = () => useServiceMutation(updateShipment, SHIPMENT_KEYS);

export const useParts = () => useQuery({ queryKey: serviceKeys.parts, queryFn: listParts });
export const usePartTypes = () => useQuery({ queryKey: serviceKeys.partTypes, queryFn: listPartTypes });
export const useReceipts = () => useQuery({ queryKey: serviceKeys.receipts, queryFn: listReceipts });
export const useMovements = (params: { part_id?: string; device_id?: string }) =>
  useQuery({ queryKey: serviceKeys.movements(params), queryFn: () => listMovements(params) });
const PART_KEYS = [['parts']];
export const useCreatePart = () => useServiceMutation(createPart, PART_KEYS);
export const useUpdatePart = () => useServiceMutation(updatePart, PART_KEYS);
export const useCreatePartType = () => useServiceMutation(createPartType, PART_KEYS);
export const useCreateReceipt = () => useServiceMutation(createReceipt, PART_KEYS);
export const useCreateMovement = () => useServiceMutation(createMovement, PART_KEYS);
