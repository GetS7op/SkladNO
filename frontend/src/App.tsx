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
import { ContainersPage } from './pages/ContainersPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { DeliveryCreatePage } from './pages/DeliveryCreatePage';
import { DeliveryPage } from './pages/DeliveryPage';
import { DevicesPage } from './pages/DevicesPage';
import { MapPage } from './pages/MapPage';
import { ModulesPage } from './pages/ModulesPage';
import { PoolsPage } from './pages/PoolsPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { WorkersPage } from './pages/WorkersPage';

const NAV = [
  {
    title: 'Учёт',
    items: [
      { to: '/deliveries', label: 'Поставки', icon: PackagePlus },
      { to: '/devices', label: 'Устройства', icon: Cpu },
      { to: '/clients', label: 'Клиенты', icon: Users },
    ],
  },
  {
    title: 'Размещение',
    items: [
      { to: '/warehouses', label: 'Склады', icon: Warehouse },
      { to: '/map', label: 'Карта', icon: Map },
      { to: '/modules', label: 'Модули', icon: Boxes },
      { to: '/containers', label: 'Контейнеры', icon: Container },
    ],
  },
  {
    title: 'Мониторинг',
    items: [
      { to: '/pools', label: 'Вайтлист пулов', icon: Network },
      { to: '/workers', label: 'Вайтлист воркеров', icon: Server },
    ],
  },
  {
    title: 'Система',
    items: [{ to: '/audit', label: 'Журнал', icon: History }],
  },
];

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
        {NAV.map((section) => (
          <div key={section.title} className="nav-group">
            <p className="nav-section">{section.title}</p>
            <nav className="primary-nav">
              {section.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className="nav-item">
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
      </aside>
      <main className="workspace">
        <Routes>
          <Route path="/" element={<Navigate to="/deliveries" replace />} />
          <Route path="/deliveries" element={<DeliveriesPage />} />
          <Route path="/deliveries/new" element={<DeliveryCreatePage />} />
          <Route path="/deliveries/:id" element={<DeliveryPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/warehouses" element={<WarehousesPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/containers" element={<ContainersPage />} />
          <Route path="/pools" element={<PoolsPage />} />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/deliveries" replace />} />
        </Routes>
      </main>
    </div>
  );
}
