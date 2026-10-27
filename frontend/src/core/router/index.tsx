import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { queryClient } from '../api/queryClient';
import { AuthProvider } from '../auth/AuthProvider';
import { ProtectedRoute, RoleRoute } from '../auth/ProtectedRoute';
import { PublicOnlyRoute } from '../auth/PublicOnlyRoute';
import { WorkspaceLayout } from '../layout/WorkspaceLayout';

// Страницы модулей грузятся по требованию: каждый раздел — отдельный кусок сборки.
const AuditPage = lazy(() => import('../../modules/audit/AuditPage').then((m) => ({ default: m.AuditPage })));
const DevicesPage = lazy(() =>
  import('../../modules/catalog/DevicesPage').then((m) => ({ default: m.DevicesPage })),
);
const ClientsPage = lazy(() =>
  import('../../modules/clients/ClientsPage').then((m) => ({ default: m.ClientsPage })),
);
const DeliveriesPage = lazy(() =>
  import('../../modules/deliveries/DeliveriesPage').then((m) => ({ default: m.DeliveriesPage })),
);
const DeliveryCreatePage = lazy(() =>
  import('../../modules/deliveries/DeliveryCreatePage').then((m) => ({ default: m.DeliveryCreatePage })),
);
const InventoryPage = lazy(() =>
  import('../../modules/deliveries/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const DevicePage = lazy(() =>
  import('../../modules/deliveries/DevicePage').then((m) => ({ default: m.DevicePage })),
);
const DeliveryPage = lazy(() =>
  import('../../modules/deliveries/DeliveryPage').then((m) => ({ default: m.DeliveryPage })),
);
const LoginPage = lazy(() =>
  import('../../modules/identity/pages/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import('../../modules/identity/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
);
const SetupPage = lazy(() =>
  import('../../modules/identity/pages/SetupPage').then((m) => ({ default: m.SetupPage })),
);
const UsersPage = lazy(() =>
  import('../../modules/identity/pages/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const DeviceLabelsPage = lazy(() =>
  import('../../modules/labels/LabelsPages').then((m) => ({ default: m.DeviceLabelsPage })),
);
const ShelfLabelsPage = lazy(() =>
  import('../../modules/labels/LabelsPages').then((m) => ({ default: m.ShelfLabelsPage })),
);
const ContainersPage = lazy(() =>
  import('../../modules/locations/ContainersPage').then((m) => ({ default: m.ContainersPage })),
);
const MapPage = lazy(() => import('../../modules/locations/MapPage').then((m) => ({ default: m.MapPage })));
const ModulesPage = lazy(() =>
  import('../../modules/locations/ModulesPage').then((m) => ({ default: m.ModulesPage })),
);
const WarehousesPage = lazy(() =>
  import('../../modules/locations/WarehousesPage').then((m) => ({ default: m.WarehousesPage })),
);
const PoolsPage = lazy(() =>
  import('../../modules/whitelists/PoolsPage').then((m) => ({ default: m.PoolsPage })),
);
const WorkersPage = lazy(() =>
  import('../../modules/whitelists/WorkersPage').then((m) => ({ default: m.WorkersPage })),
);

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<div className="auth-screen muted">Загрузка…</div>}>
            <Routes>
              <Route
                path="/login"
                element={
                  <PublicOnlyRoute>
                    <LoginPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/setup"
                element={
                  <PublicOnlyRoute setup>
                    <SetupPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                path="/invite/:token"
                element={
                  <PublicOnlyRoute>
                    <RegisterPage />
                  </PublicOnlyRoute>
                }
              />
              <Route
                element={
                  <ProtectedRoute>
                    <WorkspaceLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/inventory" replace />} />
                <Route path="deliveries" element={<DeliveriesPage />} />
                <Route path="deliveries/new" element={<DeliveryCreatePage />} />
                <Route path="deliveries/:id" element={<DeliveryPage />} />
                <Route path="inventory" element={<InventoryPage />} />
                <Route path="inventory/:id" element={<DevicePage />} />
                <Route path="devices" element={<DevicesPage />} />
                <Route path="clients" element={<ClientsPage />} />
                <Route path="warehouses" element={<WarehousesPage />} />
                <Route path="map" element={<MapPage />} />
                <Route path="labels/shelves" element={<ShelfLabelsPage />} />
                <Route path="labels/delivery/:id" element={<DeviceLabelsPage />} />
                <Route path="modules" element={<ModulesPage />} />
                <Route path="containers" element={<ContainersPage />} />
                <Route path="pools" element={<PoolsPage />} />
                <Route path="workers" element={<WorkersPage />} />
                <Route path="audit" element={<AuditPage />} />
                <Route
                  path="users"
                  element={
                    <RoleRoute min="admin">
                      <UsersPage />
                    </RoleRoute>
                  }
                />
                {/* Настройки адреса переехали в «Склады» — старые ссылки ведут туда. */}
                <Route path="settings" element={<Navigate to="/warehouses" replace />} />
                <Route path="*" element={<Navigate to="/inventory" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
