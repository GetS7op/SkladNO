import { describe, expect, it } from 'vitest';
import { maskRange } from './api';

describe('maskRange', () => {
  it('считает диапазон INDEX как сервер', () => {
    expect(maskRange('9XXXXXX')).toEqual({
      mask: '9XXXXXX',
      first: '9000000',
      last: '9999999',
      count: 1_000_000,
    });
    expect(maskRange(' 0xxxxxx ')).toMatchObject({ first: '0000001', last: '0999999', count: 999_999 });
    expect(maskRange('21ХХХХХ')).toMatchObject({ mask: '21XXXXX', first: '2100000', last: '2199999' });
  });

  it('отклоняет неверные маски', () => {
    for (const bad of ['XXXXXXX', '1234567', '1XXXXX', '1XXXXXXX', '1X2XXXX', 'A1XXXXX', '']) {
      expect(maskRange(bad)).toBeNull();
    }
  });
});
