import { describe, expect, it } from 'vitest';
import { conditionLabel, conditionSchema, hasRole } from './domain';

describe('hasRole', () => {
  it('orders roles: operator < senior < admin', () => {
    expect(hasRole('admin', 'senior')).toBe(true);
    expect(hasRole('senior', 'senior')).toBe(true);
    expect(hasRole('operator', 'senior')).toBe(false);
  });
});

describe('conditions (D-08)', () => {
  it('has four values, only factory_new is customs', () => {
    expect(conditionSchema.options).toHaveLength(4);
    expect(conditionLabel('factory_new')).toBe('Прямо с завода');
    expect(conditionLabel(null)).toBe('не указано');
  });
});
