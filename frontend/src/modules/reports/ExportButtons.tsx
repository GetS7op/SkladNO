import { Download } from 'lucide-react';
import { download } from '../../core/ui/format';
import { type ExportRegistry, exportUrl } from './api';

/** Выгрузка реестра со статистикой: XLSX, CSV, MD. */
export function ExportButtons({ registry }: { registry: ExportRegistry }) {
  return (
    <>
      {(['xlsx', 'csv', 'md'] as const).map((format) => (
        <button
          key={format}
          type="button"
          className="btn ghost"
          title={`Выгрузить в ${format.toUpperCase()}`}
          onClick={() => download(exportUrl(registry, format))}
        >
          <Download size={16} /> {format.toUpperCase()}
        </button>
      ))}
    </>
  );
}
