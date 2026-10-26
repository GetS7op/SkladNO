import { Download } from 'lucide-react';
import { download } from '../../core/ui/format';
import type { OptionItem } from '../../core/ui/Registry';
import { type ExportFormat, type ExportRegistry, exportUrl } from './api';

const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'xlsx', label: 'Экспорт XLSX' },
  { format: 'csv', label: 'Экспорт CSV' },
  { format: 'md', label: 'Экспорт MD (со статистикой)' },
];

/** Пункты меню «~option» для выгрузки реестра (SPEC: CSV, XLSX, MD со статистикой). */
export function exportOptions(registry: ExportRegistry): OptionItem[] {
  return FORMATS.map(({ format, label }) => ({
    label,
    icon: <Download size={16} />,
    onClick: () => download(exportUrl(registry, format)),
  }));
}
