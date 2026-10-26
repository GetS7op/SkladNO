import './styles.css';
import { FileUp } from 'lucide-react';
import { useState } from 'react';
import { ErrorBanner, Modal } from '../../core/ui/ui';
import type { ImportRegistry } from './api';
import { useImportRegistry } from './hooks';

const TEMPLATES = {
  devices: 'Производитель, Модель, XP (Th/s), Потребление (Вт), Размеры (мм), Вес (кг)',
  clients: 'Наименование, Заметка',
};

/** Импорт справочника: сначала проверка без записи, затем загрузка. */
export function ImportDialog({ registry, onClose }: { registry: ImportRegistry; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const check = useImportRegistry();
  const run = useImportRegistry();
  const report = run.data ?? check.data;
  const done = !!run.data;

  return (
    <Modal
      title={registry === 'devices' ? 'Импорт моделей устройств' : 'Импорт клиентов'}
      onClose={onClose}
      onSubmit={() => {
        if (done || !file) return onClose();
        if (!check.data) check.mutate({ registry, file, dryRun: true });
        else run.mutate({ registry, file, dryRun: false });
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
