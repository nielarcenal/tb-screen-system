import { describe, expect, it } from 'vitest';

import { auditTabVisible, type UserRole } from './types';

describe('auditTabVisible', () => {
  it('admits only TB-DOTS staff', () => {
    const expected: Record<UserRole, boolean> = {
      tb_dots: true,
      bhw: false,
      midwife: false,
      admin: false,
    };

    for (const [role, visible] of Object.entries(expected)) {
      expect(auditTabVisible(role as UserRole), role).toBe(visible);
    }
  });
});
