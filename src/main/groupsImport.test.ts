import { describe, expect, it } from 'vitest';
import { exportedGroupDisabled, importGroupDisabled } from './groupsImport';

describe('exportedGroupDisabled', () => {
  it('records an enabled group as not disabled', () => {
    expect(exportedGroupDisabled({ type: 'enabled' })).toBe(false);
  });

  it('records a disabled group as disabled', () => {
    expect(exportedGroupDisabled({ type: 'disabled', value: { type: 'user' } })).toBe(true);
  });

  it('records a group that is not running for any other reason as disabled', () => {
    expect(exportedGroupDisabled({ type: 'awaiting_memproofs' })).toBe(true);
  });
});

describe('importGroupDisabled', () => {
  const profile = { name: 'Garden', icon_src: '' };
  const me = { nickname: 'eric', fields: {} };

  it('keeps a group the export marked disabled disabled', () => {
    expect(importGroupDisabled({ disabled: true, groupProfile: profile, agentProfile: me })).toBe(true);
  });

  it('enables a group the export marked enabled', () => {
    expect(importGroupDisabled({ disabled: false, groupProfile: undefined, agentProfile: undefined })).toBe(false);
  });

  it('treats an older export entry with no profiles at all as a disabled group', () => {
    expect(importGroupDisabled({ groupProfile: undefined, agentProfile: undefined })).toBe(true);
  });

  it('enables an older export entry that carries any profile', () => {
    expect(importGroupDisabled({ groupProfile: profile, agentProfile: undefined })).toBe(false);
    expect(importGroupDisabled({ groupProfile: undefined, agentProfile: me })).toBe(false);
  });
});
