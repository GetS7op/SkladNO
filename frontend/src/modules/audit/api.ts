import { z } from 'zod';
import { apiGet, withQuery } from '../../core/api/client';

/** Журнал действий: когда, кто и что сделал; для изменений — старое и новое значение. */
const auditEntrySchema = z.object({
  id: z.number().int(),
  at: z.string(),
  actor: z.string(),
  entity: z.string(),
  entity_id: z.string().nullable(),
  action: z.string(),
  changes: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export type AuditParams = { entity?: string; entityId?: string };

export const listAudit = ({ entity, entityId }: AuditParams) =>
  apiGet(withQuery('/audit', { entity, entity_id: entityId }), z.array(auditEntrySchema));
