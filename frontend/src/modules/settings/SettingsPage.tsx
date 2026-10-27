import { Settings2 } from 'lucide-react';
import { useState } from 'react';
import { ErrorBanner, Field, Segmented } from '../../core/ui/ui';
import { formatAddress } from './api';
import { useSettings, useUpdateSettings } from './hooks';

/** Настройки системы (администратор). */
export function SettingsPage() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [separator, setSeparator] = useState<string | null>(null);
  const current = settings.data?.address_separator ?? 'X';
  const chosen = separator ?? current;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Настройки</h1>
          <p className="muted">Параметры системы, общие для всех пользователей</p>
        </div>
      </header>
      <section className="card">
        <h2>
          <Settings2 size={18} /> Адрес места на карте
        </h2>
        <ErrorBanner error={settings.error ?? update.error} />
        <Field
          label="Разделитель адреса MXCXSXP"
          hint={
            <>
              Адрес полки: модуль, контейнер, стеллаж, полка — например{' '}
              <b className="mono">{formatAddress(chosen, 1, 2, 3, 4)}</b>. Штрихкоды с «X», напечатанные
              раньше, сканер читает и после смены разделителя; новые наклейки печатаются с выбранным.
            </>
          }
        >
          <Segmented
            value={chosen}
            onChange={setSeparator}
            options={(settings.data?.allowed_separators ?? ['X']).map((s) => ({ value: s, label: s }))}
          />
        </Field>
        <div className="stepper-action">
          {update.isSuccess && chosen === current && <span className="muted small">Сохранено</span>}
          <button
            type="button"
            className="btn primary"
            disabled={chosen === current || update.isPending}
            onClick={() =>
              update.mutate({ address_separator: chosen }, { onSuccess: () => setSeparator(null) })
            }
          >
            Сохранить
          </button>
        </div>
      </section>
    </div>
  );
}
