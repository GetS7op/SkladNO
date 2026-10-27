import { describe, expect, it } from 'vitest';
import { effectiveRole } from './context';

describe('effectiveRole', () => {
  it('lets an administrator view the interface as another role', () => {
    expect(effectiveRole('admin', 'operator')).toBe('operator');
    expect(effectiveRole('admin', 'senior')).toBe('senior');
    expect(effectiveRole('admin', null)).toBe('admin');
  });

  it('ignores a stored view for other roles', () => {
    expect(effectiveRole('operator', 'admin')).toBe('operator');
    expect(effectiveRole('senior', 'admin')).toBe('senior');
  });
});
