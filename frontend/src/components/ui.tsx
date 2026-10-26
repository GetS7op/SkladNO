import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  onSubmit: () => void;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-label={props.title}
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
      >
        <header>
          <h2>{props.title}</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{props.children}</div>
        <footer>{props.footer}</footer>
      </form>
    </div>
  );
}

export function Field(props: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className={`field${props.error ? ' invalid' : ''}`}>
      <span className="field-label">
        {props.label}
        {props.required && <b className="req">*</b>}
      </span>
      {props.children}
      {props.error ? (
        <span className="field-error">{props.error}</span>
      ) : (
        props.hint && <span className="field-hint">{props.hint}</span>
      )}
    </label>
  );
}

export function ErrorBanner({ error }: { error: Error | null }) {
  return error ? <div className="banner error">{error.message}</div> : null;
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? 'active' : undefined}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
