import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp } from 'lucide-react';
import { useState } from 'react';
import { ApiError, type ImportReport, UNAUTHORIZED_EVENT } from '../api';
import type { OptionItem } from './Registry';
import { ErrorBanner, Modal } from './ui';

export type Registry =
  'devices' | 'inventory' | 'clients' | 'deliveries' | 'pools' | 'workers' | 'containers' | 'modules';

const FORMATS = [
  { format: 'xlsx', label: 'Экспорт XLSX' },
  { format: 'csv', label: 'Экспорт CSV' },
  { format: 'md', label: 'Экспорт MD (со статистикой)' },
] as const;

export function exportUrl(registry: Registry, format: string) {
  return `/api/v1/export/${registry}?format=${format}`;
}

/** Скачивание файла: сервер отдаёт его как вложение, страница не меняется. */
export function download(url: string) {
  const link = Object.assign(document.createElement('a'), { href: url, download: '' });
  link.click();
}

/** Пункты меню «~option» для выгрузки реестра (SPEC: CSV, XLSX, MD со статистикой). */
export function exportOptions(registry: Registry): OptionItem[] {
  return FORMATS.map(({ format, label }) => ({
    label,
    icon: <Download size={16} />,
    onClick: () => download(exportUrl(registry, format)),
  }));
}

async function uploadImport(
  registry: 'devices' | 'clients',
  file: File,
  dryRun: boolean,
): Promise<ImportReport> {
  const response = await fetch(`/api/v1/import/${registry}?dry_run=${dryRun}`, {
    method: 'POST',
    body: file,
  });
  if (!response.ok) {
    let message = `Ошибка сервера (${response.status})`;
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

const TEMPLATES = {
  devices: 'Производитель, Модель, XP (Th/s), Потребление (Вт), Размеры (мм), Вес (кг)',
  clients: 'Наименование, Заметка',
};

/** Импорт справочника: сначала проверка без записи, затем загрузка. */
export function ImportDialog({
  registry,
  onClose,
}: {
  registry: 'devices' | 'clients';
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const check = useMutation({ mutationFn: (f: File) => uploadImport(registry, f, true) });
  const run = useMutation({
    mutationFn: (f: File) => uploadImport(registry, f, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [registry] });
      queryClient.invalidateQueries({ queryKey: ['manufacturers'] });
    },
  });
  const report = run.data ?? check.data;
  const done = !!run.data;

  return (
    <Modal
      title={registry === 'devices' ? 'Импорт моделей устройств' : 'Импорт клиентов'}
      onClose={onClose}
      onSubmit={() => {
        if (done || !file) return onClose();
        if (!check.data) check.mutate(file);
        else run.mutate(file);
      }}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {done ? 'Закрыть' : 'Отмена'}
          </button>
          {!done && (
            <button
              type="submit"
              className="btn primary"
              disabled={
                !file || check.isPending || run.isPending || (!!check.data && check.data.created === 0)
              }
            >
              {check.data ? `Импортировать (${check.data.created})` : 'Проверить файл'}
            </button>
          )}
        </>
      }
    >
      <ErrorBanner error={check.error ?? run.error} />
      <p className="muted small">
        Файл CSV или XLSX с шапкой: {TEMPLATES[registry]}. Подойдёт выгрузка SkladNO. Записи, которые уже
        есть, пропускаются; каждая строка проверяется по тем же правилам, что ручной ввод.
      </p>
      <label className="file-input">
        <FileUp size={18} />
        <span>{file ? file.name : 'Выберите файл .csv или .xlsx'}</span>
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            check.reset();
            run.reset();
          }}
        />
      </label>
      {report && (
        <div className={`banner ${report.errors.length ? 'warn-banner' : 'ok'}`}>
          <b>{done ? 'Импорт выполнен' : 'Проверка (ничего не записано)'}:</b> строк {report.total},{' '}
          {done ? 'добавлено' : 'будет добавлено'} {report.created}, уже есть {report.skipped}, с ошибками{' '}
          {report.errors.length}.
          {report.errors.length > 0 && (
            <ul className="import-errors">
              {report.errors.slice(0, 50).map((e) => (
                <li key={e.row}>
                  Строка {e.row}: {e.message}
                </li>
              ))}
              {report.errors.length > 50 && <li>…и ещё {report.errors.length - 50}</li>}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
