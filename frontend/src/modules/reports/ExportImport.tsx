import './styles.css';
import type { UseMutationResult } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ErrorBanner, Modal } from '../../core/ui/ui';
import type { ImportRegistry, ImportReport } from './api';
import { useImportRegistry } from './hooks';

type FileMutation = UseMutationResult<ImportReport, Error, File>;

/**
 * Загрузка файла CSV/XLSX в два шага: «Проверить» (сервер всё проверяет и откатывает) и
 * «Загрузить». `check` и `run` — мутации с пробным и настоящим прогоном.
 */
export function FileImportDialog(props: {
  title: string;
  description: ReactNode;
  check: FileMutation;
  run: FileMutation;
  /** Подписи итогов: что считается «добавлено» и «без изменений». */
  labels: { created: string; planned: string; skipped: string; submit: string; done: string };
  onClose: () => void;
}) {
  const { check, run, labels, onClose } = props;
  const [file, setFile] = useState<File | null>(null);
  const report = run.data ?? check.data;
  const done = !!run.data;

  return (
    <Modal
      title={props.title}
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
              {check.data ? `${labels.submit} (${check.data.created})` : 'Проверить файл'}
            </button>
          )}
        </>
      }
    >
      <ErrorBanner error={check.error ?? run.error} />
      <p className="muted small">{props.description}</p>
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
          <b>{done ? labels.done : 'Проверка (ничего не записано)'}:</b> строк {report.total},{' '}
          {done ? labels.created : labels.planned} {report.created}, {labels.skipped} {report.skipped}, с
          ошибками {report.errors.length}.
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

const TEMPLATES = {
  devices: 'Производитель, Модель, XP (Th/s), Потребление (Вт), Размеры (мм), Вес (кг)',
  clients: 'Наименование, Заметка',
};

/** Импорт справочника (модели устройств, клиенты). */
export function ImportDialog({ registry, onClose }: { registry: ImportRegistry; onClose: () => void }) {
  return (
    <FileImportDialog
      title={registry === 'devices' ? 'Импорт моделей устройств' : 'Импорт клиентов'}
      description={
        <>
          Файл CSV или XLSX с шапкой: {TEMPLATES[registry]}. Подойдёт выгрузка SkladNO. Записи, которые уже
          есть, пропускаются; каждая строка проверяется по тем же правилам, что ручной ввод.
        </>
      }
      check={useImportRegistry(registry, true)}
      run={useImportRegistry(registry, false)}
      labels={{
        created: 'добавлено',
        planned: 'будет добавлено',
        skipped: 'уже есть',
        submit: 'Импортировать',
        done: 'Импорт выполнен',
      }}
      onClose={onClose}
    />
  );
}
