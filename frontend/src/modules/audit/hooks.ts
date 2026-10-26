import { useQuery } from '@tanstack/react-query';
import { type AuditParams, listAudit } from './api';

export const auditKeys = {
  all: ['audit'] as const,
  list: (params: AuditParams) => ['audit', params] as const,
};

export function useAudit(params: AuditParams) {
  return useQuery({ queryFn: () => listAudit(params), queryKey: auditKeys.list(params) });
}
