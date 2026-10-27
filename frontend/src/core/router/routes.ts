import {
  Boxes,
  ClipboardList,
  Container,
  Cpu,
  History,
  Home,
  Map,
  Network,
  PackagePlus,
  Server,
  Settings,
  Settings2,
  SlidersHorizontal,
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

/** Раздел меню: заголовок раскрывает подпункты. */
export type NavSection = { title: string; icon: LucideIcon; items: NavItem[] };

/** «Главная» — реестр INDEX, отдельным пунктом над разделами. */
export const NAV_HOME: NavItem = { to: '/inventory', label: 'Главная', icon: Home, minRole: 'operator' };

export const NAV: NavSection[] = [
  {
    title: 'Учёт',
    icon: ClipboardList,
    items: [{ to: '/deliveries', label: 'Поставки', icon: PackagePlus, minRole: 'operator' }],
  },
  {
    title: 'Преднастройки',
    icon: SlidersHorizontal,
    items: [
      { to: '/pools', label: 'Вайтлист пулов', icon: Network, minRole: 'operator' },
      { to: '/workers', label: 'Вайтлист воркеров', icon: Server, minRole: 'operator' },
    ],
  },
  {
    title: 'Настройки',
    icon: Settings,
    items: [
      { to: '/warehouses', label: 'Склады', icon: Warehouse, minRole: 'operator' },
      { to: '/map', label: 'Карта', icon: Map, minRole: 'operator' },
      { to: '/modules', label: 'Модули', icon: Boxes, minRole: 'operator' },
      { to: '/containers', label: 'Контейнеры', icon: Container, minRole: 'operator' },
      { to: '/devices', label: 'Устройства', icon: Cpu, minRole: 'operator' },
      { to: '/clients', label: 'Клиенты', icon: Users, minRole: 'operator' },
      { to: '/users', label: 'Пользователи', icon: ShieldCheck, minRole: 'admin' },
    ],
  },
  {
    title: 'Система',
    icon: Settings2,
    items: [{ to: '/audit', label: 'Журнал', icon: History, minRole: 'operator' }],
  },
];

/** Меню, видимое роли: пустые разделы не показываются. */
export function navForRole(role: Role): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => hasRole(role, item.minRole)),
  })).filter((section) => section.items.length > 0);
}

/** Раздел меню, в котором открытая страница (null — «Главная» или страница вне меню). */
export function navSectionFromPathname(pathname: string): NavSection | null {
  const item = navItemFromPathname(pathname);
  return NAV.find((section) => item && section.items.includes(item)) ?? null;
}

/** Пункт меню, к которому относится адрес (для подсветки и заголовка). */
export function navItemFromPathname(pathname: string): NavItem | null {
  if (pathname === '/' || pathname === NAV_HOME.to || pathname.startsWith(`${NAV_HOME.to}/`)) return NAV_HOME;
  for (const section of NAV) {
    for (const item of section.items) {
      if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return item;
    }
  }
  if (pathname.startsWith('/labels/shelves')) return navItemFromPathname('/map');
  if (pathname.startsWith('/labels/delivery')) return navItemFromPathname('/deliveries');
  return null;
}
