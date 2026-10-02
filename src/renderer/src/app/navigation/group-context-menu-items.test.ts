import { describe, expect, it } from 'vitest';
import { groupContextMenuActions } from './group-context-menu-items.js';

describe('groupContextMenuActions', () => {
  it('offers only enable for a disabled group', () => {
    expect(
      groupContextMenuActions({ status: 'disabled', privileged: false, hasMyProfile: false }),
    ).toEqual(['enable']);
  });

  it('offers only leave for a group still waiting for peers', () => {
    expect(
      groupContextMenuActions({ status: 'waiting', privileged: false, hasMyProfile: false }),
    ).toEqual(['leave']);
    expect(
      groupContextMenuActions({ status: 'waiting', privileged: true, hasMyProfile: true }),
    ).toEqual(['leave']);
  });

  it('offers settings and invite for a synced group where I am privileged', () => {
    expect(
      groupContextMenuActions({ status: 'synced', privileged: true, hasMyProfile: true }),
    ).toEqual(['settings', 'invite']);
  });

  it('omits invite for a synced group where I am not privileged', () => {
    expect(
      groupContextMenuActions({ status: 'synced', privileged: false, hasMyProfile: true }),
    ).toEqual(['settings']);
  });

  it('offers nothing for a synced group where I have not created my profile yet', () => {
    expect(
      groupContextMenuActions({ status: 'synced', privileged: true, hasMyProfile: false }),
    ).toEqual([]);
  });
});
