import { z } from 'zod';
import { apiUpload, apiUrl, withQuery } from '../../core/api/client';

/** Реестры, которые выгружаются в XLSX / CSV / MD (SPEC: импорт и экспорт). */
export type ExportRegistry =
  | 'devices'
  | 'inventory'
  | 'clients'
  | 'deliveries'
  | 'pools'
  | 'workers'
  | 'containers'
  | 'modules'
  | 'shipments'
  | 'parts';

export type ExportFormat = 'xlsx' | 'csv' | 'md';

export const exportUrl = (registry: ExportRegistry, format: ExportFormat) =>
  apiUrl(withQuery(`/export/${registry}`, { format }));

/** Справочники, которые загружаются из CSV / XLSX. */
export type ImportRegistry = 'devices' | 'clients';

export const importReportSchema = z.object({
  dry_run: z.boolean(),
  total: z.number().int(),
  created: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
});
export type ImportReport = z.infer<typeof importReportSchema>;

export const importRegistry = ({
  registry,
  file,
  dryRun,
}: {
  registry: ImportRegistry;
  file: File;
  dryRun: boolean;
}) => apiUpload(withQuery(`/import/${registry}`, { dry_run: dryRun }), file, importReportSchema);
