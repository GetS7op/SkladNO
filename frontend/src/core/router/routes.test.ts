import { describe, expect, it } from 'vitest';
import { navForRole, navItemFromPathname, navSectionFromPathname } from './routes';

const labels = (role: Parameters<typeof navForRole>[0]) =>
  navForRole(role).flatMap((section) => section.items.map((item) => item.label));

describe('navForRole', () => {
  it('shows users only to administrators', () => {
    expect(labels('admin')).toContain('Пользователи');
    expect(labels('senior')).not.toContain('Пользователи');
    expect(labels('operator')).not.toContain('Пользователи');
  });

  it('keeps work sections for every role', () => {
    for (const role of ['operator', 'senior', 'admin'] as const) {
      expect(labels(role)).toEqual(expect.arrayContaining(['Поставки', 'Карта', 'Журнал']));
    }
  });
});

describe('navItemFromPathname', () => {
  it.each([
    ['/', 'Главная'],
    ['/inventory', 'Главная'],
    ['/inventory/0f1e', 'Главная'],
    ['/deliveries', 'Поставки'],
    ['/deliveries/new', 'Поставки'],
    ['/deliveries/0f1e', 'Поставки'],
    ['/labels/delivery/0f1e', 'Поставки'],
    ['/labels/shelves', 'Карта'],
    ['/map', 'Карта'],
    ['/users', 'Пользователи'],
  ])('%s → %s', (pathname, label) => {
    expect(navItemFromPathname(pathname)?.label).toBe(label);
  });

  it('does not match a section by prefix of another word', () => {
    expect(navItemFromPathname('/devicesx')).toBeNull();
  });
});

describe('navSectionFromPathname', () => {
  it.each([
    ['/deliveries/new', 'Учёт'],
    ['/labels/shelves', 'Настройки'],
    ['/users', 'Настройки'],
    ['/pools', 'Преднастройки'],
    ['/audit', 'Система'],
  ])('%s → %s', (pathname, title) => {
    expect(navSectionFromPathname(pathname)?.title).toBe(title);
  });

  it('returns null for the home page and outside the menu', () => {
    expect(navSectionFromPathname('/inventory')).toBeNull();
    expect(navSectionFromPathname('/nowhere')).toBeNull();
  });
});
