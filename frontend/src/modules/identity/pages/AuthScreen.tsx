import '../styles.css';
import { LayoutGrid } from 'lucide-react';
import type { ReactNode } from 'react';

/** Каркас экранов входа, первого запуска и регистрации. */
export function AuthScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">
            <LayoutGrid size={20} />
          </span>
          <strong>SkladNO</strong>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
