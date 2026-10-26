import {
  Boxes,
  Container,
  Cpu,
  History,
  LayoutGrid,
  Map,
  Network,
  PackagePlus,
  Server,
  Users,
  Warehouse,
} from 'lucide-react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AuditPage } from './pages/AuditPage';
import { ClientsPage } from './pages/ClientsPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { DeliveryCreatePage } from './pages/DeliveryCreatePage';
import { DeliveryPage } from './pages/DeliveryPage';
import { DevicesPage } from './pages/DevicesPage';
import { PlannedPage, PLANNED } from './pages/PlannedPage';

const NAV = [
  { to: '/deliveries', label: 'Поставки', icon: PackagePlus },
  { to: '/devices', label: 'Устройства', icon: Cpu },
  { to: '/clients', label: 'Клиенты', icon: Users },
  { to: '/audit', label: 'Журнал', icon: History },
];

const PLANNED_ICONS = {
  pools: Network,
  workers: Server,
  warehouses: Warehouse,
  containers: Container,
  modules: Boxes,
  map: Map,
} as const;

export function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">
            <LayoutGrid size={20} />
          </span>
          <span>
            <strong>SkladNO</strong>
            <span>майнинг-ферма</span>
          </span>
        </NavLink>
        <nav className="primary-nav">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className="nav-item">
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="nav-section">Следующий этап</p>
        <nav className="primary-nav">
          {PLANNED.map((p) => {
            const Icon = PLANNED_ICONS[p.slug];
            return (
              <NavLink key={p.slug} to={`/planned/${p.slug}`} className="nav-item planned">
                <Icon size={18} />
                {p.title}
                <span className="tag">{p.id}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>
      <main className="workspace">
        <Routes>
          <Route path="/" element={<Navigate to="/deliveries" replace />} />
          <Route path="/deliveries" element={<DeliveriesPage />} />
          <Route path="/deliveries/new" element={<DeliveryCreatePage />} />
          <Route path="/deliveries/:id" element={<DeliveryPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/planned/:slug" element={<PlannedPage />} />
          <Route path="*" element={<Navigate to="/deliveries" replace />} />
        </Routes>
      </main>
    </div>
  );
}
