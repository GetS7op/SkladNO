import { z } from 'zod';

/** Общие перечисления предметной области и их подписи (используются несколькими модулями). */

/** Склад (назначение поставки, расположение модуля) — код из справочника складов; имя — через useWarehouseName. */
export const destinationSchema = z.string();
export type Destination = z.infer<typeof destinationSchema>;

export const stageSchema = z.enum(['created', 'receiving', 'confirmation', 'closed']);
export type Stage = z.infer<typeof stageSchema>;

export const STAGES: { value: Stage; label: string }[] = [
  { value: 'created', label: 'Создание' },
  { value: 'receiving', label: 'Приём поставки' },
  { value: 'confirmation', label: 'Подтверждение поставки' },
  { value: 'closed', label: 'Закрытие поставки' },
];

export const stageLabel = (stage: Stage) => STAGES.find((s) => s.value === stage)?.label ?? stage;

/** D-05/D-08: «Состояние» поставки; таможенные — только «Прямо с завода». */
export const conditionSchema = z.enum(['factory_new', 'slightly_used', 'field_tested', 'battle_hardened']);
export type Condition = z.infer<typeof conditionSchema>;

export const CONDITIONS: { value: Condition; label: string; hint: string }[] = [
  { value: 'factory_new', label: 'Прямо с завода', hint: 'таможенные' },
  { value: 'slightly_used', label: 'Немного поношенные', hint: 'не таможенные' },
  { value: 'field_tested', label: 'После полевых испытаний', hint: 'не таможенные' },
  { value: 'battle_hardened', label: 'Закаленные в боях', hint: 'не таможенные' },
];

export const conditionLabel = (value: Condition | null) =>
  value ? (CONDITIONS.find((c) => c.value === value)?.label ?? value) : 'не указано';

export const roleSchema = z.enum(['operator', 'senior', 'admin']);
export type Role = z.infer<typeof roleSchema>;

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'operator', label: 'СА', hint: 'Просмотр, создание поставок, приём сканированием' },
  { value: 'senior', label: 'Старший СА', hint: '+ справочники, подтверждение и закрытие поставок' },
  { value: 'admin', label: 'Администратор', hint: '+ пользователи и приглашения' },
];

const RANK: Record<Role, number> = { operator: 0, senior: 1, admin: 2 };

export const roleLabel = (role: Role) => ROLES.find((r) => r.value === role)?.label ?? role;

/** Роль не ниже `min`. */
export const hasRole = (role: Role, min: Role) => RANK[role] >= RANK[min];
