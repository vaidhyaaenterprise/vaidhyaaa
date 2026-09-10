import { describe, expect, it } from 'vitest';

import { isPendingConfirmationStatus, parseClinicSettingsPatch } from './shared-contracts';

describe('shared contract imports (web)', () => {
  it('uses shared enums and dto subpaths without circular dependency', () => {
    expect(isPendingConfirmationStatus('pending_confirmation')).toBe(true);
    expect(isPendingConfirmationStatus('confirmed')).toBe(false);

    const parsed = parseClinicSettingsPatch({ agent_enabled: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.agent_enabled).toBe(true);
    }
  });
});
