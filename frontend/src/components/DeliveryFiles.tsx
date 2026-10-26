import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileImage, FileText, Paperclip } from 'lucide-react';
import { useRef } from 'react';
import { ApiError, UNAUTHORIZED_EVENT } from '../api';
import { formatDateTime } from '../format';
import { ErrorBanner } from './ui';

interface DeliveryFile {
  id: string;
  name: string;
  content_type: string;
  size: number;
  uploaded_by: string;
  uploaded_at: string;
}

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

async function uploadFile(deliveryId: string, file: File): Promise<DeliveryFile> {
  const response = await fetch(
    `/api/v1/deliveries/${deliveryId}/files?name=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      body: file,
    },
  );
  if (!response.ok) {
    let message = response.status === 413 ? 'Файл больше 25 МБ' : `Ошибка сервера (${response.status})`;
    try {
      message = (await response.json()).message ?? message;
    } catch {
      // ответ без JSON
    }
    if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(message, response.status);
  }
  return response.json();
}

/** F-03: файлы документа-основания (jpg, png, pdf). Открываются в новой вкладке. */
export function DeliveryFiles({ deliveryId }: { deliveryId: string }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const files = useQuery({
    queryKey: ['delivery', deliveryId, 'files'],
    queryFn: async () => {
      const response = await fetch(`/api/v1/deliveries/${deliveryId}/files`);
      if (!response.ok) throw new ApiError(`Ошибка сервера (${response.status})`, response.status);
      return (await response.json()) as DeliveryFile[];
    },
  });
  const upload = useMutation({
    mutationFn: async (list: File[]) => {
      for (const file of list) await uploadFile(deliveryId, file);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery', deliveryId, 'files'] });
      queryClient.invalidateQueries({ queryKey: ['audit'] });
    },
  });

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
              <a href={`/api/v1/files/${f.id}`} target="_blank" rel="noreferrer">
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
