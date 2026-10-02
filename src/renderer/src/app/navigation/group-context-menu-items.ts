/** Actions a group's sidebar context menu can request of the group view. */
export type GroupContextAction = 'settings' | 'invite' | 'leave' | 'enable';

/**
 * Where a group stands from my point of view: synced (its profile is known),
 * waiting (no peer has delivered its profile yet) or disabled (its app is
 * turned off in the conductor).
 */
export type GroupSidebarStatus = 'synced' | 'waiting' | 'disabled';

/**
 * Which actions the group context menu offers. A disabled group can only be
 * re-enabled. A group still waiting for peers has no profile or settings to
 * show yet, so leaving is the only option. A synced group offers nothing
 * until I have created my profile in it, since its home shows only the
 * profile form until then. Inviting is reserved to privileged members,
 * matching the group home's "Invite People" button.
 */
export function groupContextMenuActions(opts: {
  status: GroupSidebarStatus;
  privileged: boolean;
  hasMyProfile: boolean;
}): GroupContextAction[] {
  switch (opts.status) {
    case 'disabled':
      return ['enable'];
    case 'waiting':
      return ['leave'];
    case 'synced':
      if (!opts.hasMyProfile) return [];
      return opts.privileged ? ['settings', 'invite'] : ['settings'];
  }
}
