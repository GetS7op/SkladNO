import {
  Boxes,
  Container,
  Cpu,
  History,
  Map,
  Network,
  PackagePlus,
  Server,
  ShieldCheck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { hasRole, type Role } from '../domain';

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Раздел виден, начиная с этой роли. */
  minRole: Role;
};

export type NavSection = { title: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    title: 'Учёт',
    items: [
      { to: '/deliveries', label: 'Поставки', icon: PackagePlus, minRole: 'operator' },
      { to: '/devices', label: 'Устройства', icon: Cpu, minRole: 'operator' },
      { to: '/clients', label: 'Клиенты', icon: Users, minRole: 'operator' },
    ],
  },
  {
    title: 'Размещение',
    items: [
      { to: '/warehouses', label: 'Склады', icon: Warehouse, minRole: 'operator' },
      { to: '/map', label: 'Карта', icon: Map, minRole: 'operator' },
      { to: '/modules', label: 'Модули', icon: Boxes, minRole: 'operator' },
      { to: '/containers', label: 'Контейнеры', icon: Container, minRole: 'operator' },
    ],
  },
  {
    title: 'Мониторинг',
    items: [
      { to: '/pools', label: 'Вайтлист пулов', icon: Network, minRole: 'operator' },
      { to: '/workers', label: 'Вайтлист воркеров', icon: Server, minRole: 'operator' },
    ],
  },
  {
    title: 'Система',
    items: [
      { to: '/audit', label: 'Журнал', icon: History, minRole: 'operator' },
      { to: '/users', label: 'Пользователи', icon: ShieldCheck, minRole: 'admin' },
    ],
  },
];

/** Меню, видимое роли: пустые разделы не показываются. */
export function navForRole(role: Role): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => hasRole(role, item.minRole)),
  })).filter((section) => section.items.length > 0);
}

/** Раздел меню, к которому относится адрес (для подсветки и заголовка). */
export function navItemFromPathname(pathname: string): NavItem | null {
  for (const section of NAV) {
    for (const item of section.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return item;
    }
  }
  if (pathname.startsWith('/labels/shelves')) return navItemFromPathname('/map');
  if (pathname.startsWith('/labels/delivery')) return navItemFromPathname('/deliveries');
  return null;
}
