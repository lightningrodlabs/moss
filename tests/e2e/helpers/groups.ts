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
  /**
   * Per-group nickname for the moss-create-profile screen that appears after
   * group creation. Defaults to 'tester'. Must be at least 3 chars.
   */
  nickname?: string;
};

/**
 * If the moss-create-profile screen is showing (which happens once per agent
 * the first time they enter a group), fill in the nickname and press
 * "Enter the space". Idempotent — does nothing if the screen isn't visible.
 *
 * why: createGroupFromMainDashboard and joinGroupByInviteLink both leave the
 * agent on this screen the first time around. Without setting a profile, the
 * group view never finishes loading, so amIPrivileged() stays false and the
 * Invite People button never renders.
 */
export async function enterSpaceIfPrompted(page: Page, nickname: string) {
  // why: ANY Playwright locator action (.click, .fill, .pressSequentially,
  // .evaluate via locator) against elements inside the moss-edit-profile
  // shadow tree triggers Playwright's internal "generateSelector" crash —
  // the engine can't synthesize a stable CSS selector for these specific
  // Lit + Shoelace shadow-root layouts. We do the entire interaction inside
  // a single page.evaluate, which doesn't go through that codepath.

  // why: moss-create-profile appears asynchronously after a group is created
  // or joined — empirically about 5s after the join dialog closes. A simple
  // count check here races: count == 0 just means the screen hasn't mounted
  // yet, not that no profile is needed. Wait up to 20s for it to appear.
  // If it never does, this agent already has a saved persona for this group
  // and we can move on.
  try {
    await page.waitForSelector('moss-create-profile', { state: 'attached', timeout: 20_000 });
  } catch {
    return;
  }

  await page.evaluate(async (v: string) => {
    function findInDeepDom(root: Document | ShadowRoot, sel: string): Element | null {
      const direct = root.querySelector(sel);
      if (direct) return direct;
      for (const el of Array.from(root.querySelectorAll('*'))) {
        const sr = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
        if (sr) {
          const found = findInDeepDom(sr, sel);
          if (found) return found;
        }
      }
      return null;
    }

    // Scope: moss-create-profile is the screen we want. moss-edit-profile is
    // also rendered inside moss-settings; explicitly walk into the create-
    // profile screen first so we get the right component.
    const createEl = findInDeepDom(document, 'moss-create-profile');
    if (!createEl) throw new Error('moss-create-profile not found in deep DOM');
    const editEl = (createEl.shadowRoot
      ? findInDeepDom(createEl.shadowRoot, 'moss-edit-profile')
      : null) as
      | (HTMLElement & {
          nickname?: string;
          disabled?: boolean;
          checkDisabled?: () => void;
          emitSaveProfile?: () => void;
          updateComplete?: Promise<unknown>;
        })
      | null;
    if (!editEl) throw new Error('moss-edit-profile not found inside moss-create-profile');

    // Mirror the value on the visible sl-input so the screen displays what
    // we set. Pure cosmetic — the form's actual save reads `editEl.nickname`.
    const sl = (editEl.shadowRoot?.querySelector('sl-input#nickname-input') ?? null) as
      | (HTMLElement & { value: string })
      | null;
    if (sl) sl.value = v;

    editEl.nickname = v;
    if (typeof editEl.checkDisabled === 'function') editEl.checkDisabled();

    // why: wait for Lit to flush the disabled-attr update before clicking.
    // Without this, the submit button still has the disabled attribute from
    // the prior render and the click is a no-op.
    if (editEl.updateComplete && typeof editEl.updateComplete.then === 'function') {
      await editEl.updateComplete;
    }

    // The submit button is inside moss-edit-profile's shadow root. Click it
    // directly. Avoiding the @click handler indirection by calling the
    // component's `emitSaveProfile` would also work, but the click path runs
    // the disabled-attr check end-to-end — which is closer to user behavior.
    const btn = editEl.shadowRoot?.querySelector(
      'button.moss-button:not([disabled])',
    ) as HTMLButtonElement | null;
    if (!btn) {
      throw new Error('enter-the-space button is still disabled after nickname set');
    }
    btn.click();
  }, nickname);

  // Success signal: moss-create-profile unmounts.
  await expect(page.locator('moss-create-profile')).toHaveCount(0, { timeout: 30_000 });
}

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
  //
  // why: explicit wait + scope to groups-sidebar before the click. Without
  // these, on a cold dashboard the locator can resolve to the document root
  // before groups-sidebar's reactive store is populated, and Playwright's
  // actionability-retry hits a 30s wall trying to click an element whose
  // shadow ancestor's layout is still settling.
  const addGroupButton = page
    .locator('groups-sidebar')
    .getByRole('button', { name: 'Add Group' });
  await expect(addGroupButton).toBeVisible({ timeout: 30_000 });
  await addGroupButton.click();

  // Pick "Create Group" in the choice dialog. We rely on Playwright's
  // auto-filtering to the visible/actionable button — the form's submit also
  // labeled "Create Group" hasn't been opened yet at this point.
  const createGroupChoice = page.getByRole('button', { name: /create group/i });
  await expect(createGroupChoice).toBeVisible({ timeout: 10_000 });
  await createGroupChoice.click();

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

  // Note: the moss-create-profile screen ("Enter the space") may appear here
  // the first time this agent enters any group. We do NOT auto-handle it from
  // this helper — only some tests need the group view fully entered, and the
  // saved-persona pre-population can leave the button disabled if you call
  // enterSpaceIfPrompted twice with the same nickname. Tests that need the
  // group fully entered should call enterSpaceIfPrompted explicitly.
}

/**
 * Join the currently-selected agent into a group via paste-an-invite-link.
 *
 * Drives: Add Group dialog → Join Group → paste link → submit. The join
 * succeeds when the join-group-dialog hides itself (`sl-dialog[open]` goes away).
 */
export async function joinGroupByInviteLink(page: Page, inviteLink: string) {
  await waitForState(page, ['Running']);
  await page.getByRole('button', { name: 'Add Group' }).click();
  // why: scope to the choice dialog. There's also a "Join Group" submit button
  // *inside* the join-group-dialog (form submit), which would match the same
  // role+name once that dialog opens. Playwright's auto-actionability picks
  // the visible/enabled one, but being explicit avoids races on slower hosts.
  await page.getByRole('button', { name: /join group/i }).first().click();

  const joinDialog = page.locator('join-group-dialog');
  await joinDialog.getByLabel(/invite link/i).fill(inviteLink);
  await joinDialog.locator('button[type="submit"]').click();

  // Dialog closes on success — same shape as create-group success signal.
  await expect(joinDialog.locator('sl-dialog[open]')).toHaveCount(0, { timeout: 120_000 });
  // moss-create-profile may appear if this is the agent's first group entry.
  // Tests that need to interact with the group beyond the sidebar should call
  // enterSpaceIfPrompted explicitly afterwards.
}

/**
 * Open the Invite People dialog for the currently-selected group, read the
 * invite link out of the input, and close the dialog. Returns the link.
 *
 * Requires the agent to be a steward/progenitor of the group — otherwise the
 * "Invite People" button is hidden (see group-area-sidebar.ts:652-668).
 * Tests created with `createGroupFromMainDashboard` default to stewarded so
 * the creator IS privileged.
 */
export async function getCurrentGroupInviteLink(page: Page): Promise<string> {
  // why: amIPrivileged() returns false until myAccountabilities resolves to
  // 'complete'. The Invite People button is gated on that, so wait for it
  // to be present before clicking instead of racing a click timeout.
  await expect(page.getByRole('button', { name: 'Invite People' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Invite People' }).click();

  // why: sl-input is a custom element, so locator.inputValue() rejects it
  // ("Node is not an <input>"). Read its `.value` JS property via evaluate.
  // Poll because the template binds `.value=...` reactively — first render
  // frame may have an empty value before invitationUrl resolves.
  const readLink = () =>
    page
      .locator('invite-people-dialog sl-input.copy-link-input')
      .evaluate((el) => (el as HTMLElement & { value: string }).value);
  await expect.poll(readLink, { timeout: 10_000 }).toMatch(/invite/i);
  const link = await readLink();

  // Close the dialog so it doesn't sit on top of the peer-list when we go
  // check that. sl-dialog dismisses on Escape by default.
  await page.keyboard.press('Escape');
  await expect(page.locator('invite-people-dialog sl-dialog[open]')).toHaveCount(0, {
    timeout: 5_000,
  });

  return link;
}
