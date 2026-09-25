export type InviteTab = 'code' | 'network';

/**
 * What the invite dialog shows. The local-network pane owns a UDP socket for as
 * long as it is mounted, so it is mounted only while the dialog is open and
 * only after someone has chosen its tab. Once chosen it stays mounted behind
 * the other tab, so a listing is not stopped and its countdown not reset by
 * switching tabs.
 */
export type InviteDialogState = {
  open: boolean;
  tab: InviteTab;
  networkVisited: boolean;
};

export function initialInviteDialog(): InviteDialogState {
  return { open: false, tab: 'code', networkVisited: false };
}

/**
 * A closed dialog returns to the invitation tab. Reopening it must not bind the
 * socket before someone asks for the network again, and every tab it can open
 * on has content to show.
 */
export function closeInviteDialog(state: InviteDialogState): InviteDialogState {
  return { ...state, open: false, tab: 'code', networkVisited: false };
}

export function openInviteDialog(state: InviteDialogState): InviteDialogState {
  return { ...state, open: true };
}

export function selectInviteTab(state: InviteDialogState, tab: InviteTab): InviteDialogState {
  return { ...state, tab, networkVisited: state.networkVisited || tab === 'network' };
}

export function visibleInvitePanes(state: InviteDialogState): {
  inviteCode: boolean;
  networkPane: boolean;
} {
  return {
    inviteCode: state.tab === 'code',
    networkPane: state.open && state.networkVisited,
  };
}
