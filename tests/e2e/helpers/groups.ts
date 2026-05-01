import { Page, expect } from '@playwright/test';
import { waitForState } from './bootToReady';

/**
 * Helpers for group creation / joining flows.
 *
 * Functional (not classes) — see the philosophy section of
 * plans/ui-testing-and-cruft-cleanup.md for why. Prefer role-based locators;
 * reach for data-testid / class selectors only on opaque elements with no
 * semantic role.
 */

export type CreateGroupOptions = {
  name: string;
  /** Group type: 'stewarded' (default) or 'unstewarded'. */
  groupType?: 'stewarded' | 'unstewarded';
  /** Path to an avatar image on disk. If omitted, the first default icon is picked. */
  avatarPath?: string;
};

/**
 * Create a group from main-dashboard. Assumes the app is already in the
 * Running state (which is where unpackaged builds land on a fresh profile).
 *
 * Flow: groups-sidebar "+" → add-group-dialog → "Create Group" → fill form →
 * dialog closes → main-dashboard switches to the new group.
 */
export async function createGroupFromMainDashboard(page: Page, opts: CreateGroupOptions) {
  await waitForState(page, ['Running']);

  // Open the add-group dialog from the groups sidebar's "+" button.
  // The button is icon-only — we added aria-label="Add Group" in
  // groups-sidebar.ts so role-based location works.
  await page.getByRole('button', { name: 'Add Group' }).click();

  // Pick "Create Group" in the choice dialog. We rely on Playwright's
  // auto-filtering to the visible/actionable button — the form's submit also
  // labeled "Create Group" hasn't been opened yet at this point.
  await page.getByRole('button', { name: /create group/i }).click();

  // Fill the create-group form. Scope to the create-group-dialog so we don't
  // accidentally match form fields elsewhere.
  const createDialog = page.locator('create-group-dialog');
  await createDialog.getByLabel(/group name/i).fill(opts.name);

  // why: moss-select-avatar-fancy auto-picks a random default icon in
  // firstUpdated() (see moss-select-avatar-fancy.ts:59-62), so the form's
  // required `icon_src` field is already populated by the time the dialog
  // shows. We only need to interact with the avatar if the test wants a
  // specific image uploaded from disk.
  if (opts.avatarPath) {
    await createDialog.locator('input[type="file"]').setInputFiles(opts.avatarPath);
  }

  // Group-type radio: stewarded ("1") is the default.
  if (opts.groupType === 'unstewarded') {
    await createDialog.getByRole('radio', { name: /unstewarded/i }).click();
  }

  // Submit. The form has a single submit button labeled "Create Group" (or a
  // spinner during commit). Use type=submit selector to disambiguate from any
  // other "Create Group" labeled buttons that might be on screen briefly.
  await createDialog.locator('button[type="submit"]').click();

  // The dialog hides after a successful commit and a `group-created` event
  // fires; sl-dialog removes its `open` attribute. Use that as the close signal.
  await expect(createDialog.locator('sl-dialog[open]')).toHaveCount(0, { timeout: 60_000 });
}

export async function joinGroupByInviteLink(page: Page, inviteLink: string) {
  await waitForState(page, ['Running']);
  await page.getByRole('button', { name: 'Add Group' }).click();
  const addGroupDialog = page.locator('#add-group-dialog');
  await expect(addGroupDialog).toBeVisible();
  await addGroupDialog.getByRole('button', { name: /join group/i }).click();

  // The join-group dialog locator + invite-link field locator will be tightened
  // when smoke #3 / #9 are first wired up against a real build.
  await page.getByLabel(/invite.*link/i).fill(inviteLink);
  await page.getByRole('button', { name: /join/i }).click();
  await waitForState(page, ['Running'], 120_000);
}

/**
 * Read an invite link for the current group from the first-agent UI.
 * Returns the link string. Used by smoke #9 to bootstrap the second agent.
 */
export async function getCurrentGroupInviteLink(_page: Page): Promise<string> {
  // why: there is no programmatic surface for this yet — pulling from clipboard
  // after clicking "copy invite" is the realistic path. To be filled in once
  // the smoke suite first exercises it; throw early so it's obvious in failures.
  throw new Error('getCurrentGroupInviteLink: not yet implemented — wire up on first use');
}
