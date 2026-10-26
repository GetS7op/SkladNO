import { FileImage, FileText, Paperclip } from 'lucide-react';
import { useRef } from 'react';
import { formatDateTime } from '../../core/ui/format';
import { ErrorBanner } from '../../core/ui/ui';
import { deliveryFileUrl } from './api';
import { useDeliveryFiles, useUploadDeliveryFiles } from './hooks';

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

/** F-03: файлы документа-основания (jpg, png, pdf). Открываются в новой вкладке. */
export function DeliveryFiles({ deliveryId }: { deliveryId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const files = useDeliveryFiles(deliveryId);
  const upload = useUploadDeliveryFiles(deliveryId);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Файлы документа-основания</h2>
        <button
          type="button"
          className="btn ghost"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          <Paperclip size={16} /> {upload.isPending ? 'Загрузка…' : 'Прикрепить'}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = '';
            if (list.length) upload.mutate(list);
          }}
        />
      </div>
      <ErrorBanner error={upload.error ?? files.error} />
      {files.data?.length === 0 && (
        <p className="muted">Файлов нет. Можно прикрепить JPG, PNG или PDF до 25 МБ.</p>
      )}
      {files.data && files.data.length > 0 && (
        <ul className="files">
          {files.data.map((f) => (
            <li key={f.id}>
              {f.content_type === 'application/pdf' ? <FileText size={18} /> : <FileImage size={18} />}
              <a href={deliveryFileUrl(f.id)} target="_blank" rel="noreferrer">
                {f.name}
              </a>
              <span className="muted small">
                {formatSize(f.size)} · {f.uploaded_by} · {formatDateTime(f.uploaded_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
