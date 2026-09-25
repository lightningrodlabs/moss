import { describe, expect, it } from 'vitest';

import {
  closeInviteDialog,
  initialInviteDialog,
  openInviteDialog,
  selectInviteTab,
  visibleInvitePanes,
} from './invite-dialog-state.js';

describe('invite dialog state', () => {
  it('opens on the invitation tab with the network pane unmounted', () => {
    const state = openInviteDialog(initialInviteDialog());
    expect(visibleInvitePanes(state)).toEqual({ inviteCode: true, networkPane: false });
  });

  it('mounts the network pane once its tab is chosen', () => {
    const state = selectInviteTab(openInviteDialog(initialInviteDialog()), 'network');
    expect(visibleInvitePanes(state)).toEqual({ inviteCode: false, networkPane: true });
  });

  it('keeps the network pane mounted behind the invitation tab', () => {
    let state = openInviteDialog(initialInviteDialog());
    state = selectInviteTab(state, 'network');
    state = selectInviteTab(state, 'code');
    expect(state.networkVisited).toBe(true);
    expect(visibleInvitePanes(state)).toEqual({ inviteCode: true, networkPane: true });
  });

  it('shows the invitation tab again when the dialog is reopened from the network tab', () => {
    let state = openInviteDialog(initialInviteDialog());
    state = selectInviteTab(state, 'network');
    state = openInviteDialog(closeInviteDialog(state));
    expect(visibleInvitePanes(state)).toEqual({ inviteCode: true, networkPane: false });
  });

  it('mounts nothing while the dialog is closed', () => {
    const state = closeInviteDialog(
      selectInviteTab(openInviteDialog(initialInviteDialog()), 'network'),
    );
    expect(visibleInvitePanes(state).networkPane).toBe(false);
  });
});
