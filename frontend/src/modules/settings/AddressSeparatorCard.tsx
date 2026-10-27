import { Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useCan } from '../../core/auth/context';
import { ErrorBanner, Field, Segmented } from '../../core/ui/ui';
import { formatAddress } from './api';
import { useSettings, useUpdateSettings } from './hooks';

/** Адрес места на карте: разделитель MXCXSXP. Меняет администратор, остальные видят текущий. */
export function AddressSeparatorCard() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const isAdmin = useCan('admin');
  const [separator, setSeparator] = useState<string | null>(null);
  const current = settings.data?.address_separator ?? 'X';
  const chosen = separator ?? current;

  return (
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
            <b className="mono">{formatAddress(chosen, 1, 2, 3, 4)}</b>. Штрихкоды с «X», напечатанные раньше,
            сканер читает и после смены разделителя; новые наклейки печатаются с выбранным.
            {!isAdmin && ' Меняет администратор.'}
          </>
        }
      >
        <Segmented
          value={chosen}
          onChange={isAdmin ? setSeparator : () => undefined}
          options={(settings.data?.allowed_separators ?? ['X'])
            .filter((s) => isAdmin || s === current)
            .map((s) => ({ value: s, label: s }))}
        />
      </Field>
      {isAdmin && (
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
      )}
    </section>
  );
}
