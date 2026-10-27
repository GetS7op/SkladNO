import { describe, expect, it } from 'vitest';
import { BUILTIN_VALUE_LABELS, flattenChanges, renderValue } from './changes';

describe('flattenChanges', () => {
  it('раскрывает вложенный профиль и скрывает пустые и служебные поля', () => {
    const changes = {
      id: 'x',
      profile: { login: 'ivanov', last_name: 'Иванов', telegram: null },
      role: 'operator',
    };
    expect(flattenChanges(changes, new Set(['id']))).toEqual([
      ['login', 'ivanov'],
      ['last_name', 'Иванов'],
      ['role', 'operator'],
    ]);
  });

  it('оставляет пару «было/стало» целой', () => {
    expect(flattenChanges({ active: { old: true, new: false } }, new Set())).toEqual([
      ['active', { old: true, new: false }],
    ]);
  });
});

describe('renderValue', () => {
  it('показывает роль названием, а время — по-русски', () => {
    expect(renderValue('operator', BUILTIN_VALUE_LABELS.role)).toBe('СА');
    expect(renderValue('2026-10-28T04:19:34.277717378Z')).not.toContain('T04');
  });

  it('пары, флаги и списки', () => {
    expect(renderValue({ old: true, new: false })).toBe('да → нет');
    expect(renderValue([1, 2, 3])).toBe('1, 2, 3');
    expect(renderValue(null)).toBe('—');
  });
});
