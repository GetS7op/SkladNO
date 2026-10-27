import { describe, expect, it } from 'vitest';
import { formatDimensions, newRequestId, toCsv } from './format';

describe('formatDimensions', () => {
  it('accepts any separators like the server (F-01 R-02)', () => {
    for (const raw of ['400 195 290', '400x195x290', '400 х 195 Х 290', '400*195*290']) {
      expect(formatDimensions(raw)).toEqual({ value: '400x195x290' });
    }
  });

  it('treats empty input as no value', () => {
    expect(formatDimensions('  ')).toEqual({ value: null });
  });

  it('explains bad input', () => {
    expect(formatDimensions('400 195').error).toMatch(/три числа/);
    expect(formatDimensions('400мм 195 290').error).toMatch(/Недопустимый символ/);
  });
});

describe('toCsv', () => {
  it('quotes separators and starts with BOM for Excel', () => {
    const csv = toCsv(
      ['Имя', 'Кол-во'],
      [
        ['А; Б', 3],
        [null, 'x"y'],
      ],
    );
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"А; Б";3');
    expect(csv).toContain(';"x""y"');
  });
});

describe('newRequestId', () => {
  it('looks like a UUID v4', () => {
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
