import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/moss';
import { waitForBoot, startFreshIfLegacyImport } from '../helpers/bootToReady';
import {
  createGroupFromMainDashboard,
  enterSpaceIfPrompted,
  getCurrentGroupInviteLink,
  joinGroupByInviteLink,
} from '../helpers/groups';
import { openToolLibrary, expectPeerCount } from '../helpers/tools';
import { openSettings, openLanguageTab } from '../helpers/settings';
import {
  prepareForCapture,
  shot,
  shotOf,
  shotDialog,
  DIALOG_SETTLE_MS,
} from '../helpers/screenshots';

/**
 * Screenshot captures for the Moss user guide — one three-agent flow that
 * produces every shot the guide uses.
 *
 * Flow:
 *   - Agent 1 (Alex) boots, drives the up-front dialog captures, creates
 *     the Book Club group, seeds its dashboard with a Markdown tile, and
 *     emits an invite link.
 *   - Agent 2 (Sam) boots and joins via that link — the join-group-dialog
 *     shot is taken on the way through.
 *   - Agent 3 (Robin) boots and joins quietly (no shot of their own).
 *   - Agent 1 waits for both peers to show up, then drives the rest of the
 *     captures — peer panel, group settings tabs, Moss settings tabs, tool
 *     library, install five tools (with Emergence disabled first so the
 *     final toast is from Vines), populated group view, Group Tools tab.
 *
 * Why three agents instead of one: every in-group shot then includes the
 * actual member list, the peer counter shows a real "2/2 online," and the
 * Members tab finally has three distinct entries instead of just the
 * creator.
 *
 * Caveat: e2e launches are unpackaged builds, which run in dev mode and
 * skip the production InitialSetup / first-run screens. That one screen
 * still has to be captured by hand against a packaged build.
 */

// Logo for the "Book Club" example so every screenshot shows the same group
// icon instead of whichever default Moss randomly picks. Passed via avatarPath
// to createGroupFromMainDashboard.
const BOOK_CLUB_LOGO = path.resolve(__dirname, 'fixtures', 'book-club-logo.svg');

const GROUP = { name: 'Book Club', avatarPath: BOOK_CLUB_LOGO };
const ALEX = 'Alex';
const SAM = 'Sam';
const ROBIN = 'Robin';

const GROUP_DESCRIPTION =
  'A small reading circle. We pick **one book a month** and meet to talk through it.\n\n' +
  '- Next up: *Parable of the Sower*\n' +
  '- Meetings: every other Thursday';

const TOOLS_TO_INSTALL_AFTER_EMERGENCE = ['Gamez', 'Notebooks', 'KanDo', 'Vines'];

// =============================================================================
// Helpers (capture-specific; lean on private UI shapes)
// =============================================================================

/**
 * Seed the group-home dashboard with a single Markdown tile carrying the
 * group's overview text, then save.
 *
 * The old "+ Add Description" textarea is gone — group home is now a
 * tile-based dashboard (group-dashboard.ts). The steward edit flow is:
 * "Edit group home" (header pencil) → palette appears → add a markdown tile
 * → fill its textarea → Add → Save. We invoke the dashboard's public
 * `requestAddTile('markdown')` rather than dragging a palette chip onto the
 * grid: gridstack's HTML5 drag-in is flaky headless, and the add/append/save
 * path is identical either way. Mirrors tests/e2e/smoke/11.group-dashboard.spec.ts.
 */
async function seedGroupDashboard(w: Page, text: string) {
  await expect(w.locator('group-dashboard')).toBeVisible({ timeout: 60_000 });

  // Enter edit mode via the header pencil (icon-only; accessible name is its title).
  await w.getByRole('button', { name: /Edit group home/i }).click();
  await expect(w.getByRole('button', { name: /^Save$/i })).toBeVisible({ timeout: 10_000 });
  await expect(w.locator('group-dashboard .dash-palette')).toBeVisible({ timeout: 10_000 });

  // ---- dashboard-palette (cropped to the floating palette) ----------------
  // Capture it now, while it's clean (no tile added yet).
  await w.waitForTimeout(DIALOG_SETTLE_MS);
  await shotOf(w.locator('group-dashboard .dash-palette'), 'dashboard-palette');

  // Open the add-tile dialog for a markdown tile.
  await w.evaluate(() => {
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
    const dash = findInDeepDom(document, 'group-dashboard') as
      | (Element & { requestAddTile?: (k: string) => void })
      | null;
    if (!dash?.requestAddTile) throw new Error('group-dashboard.requestAddTile not found');
    dash.requestAddTile('markdown');
  });

  // Fill the tile's markdown source. sl-textarea's label lives in shadow DOM,
  // so target the inner native <textarea> (Playwright pierces shadow roots for
  // CSS locators).
  const addPanel = w.locator('.add-tile-panel');
  await expect(addPanel).toBeVisible({ timeout: 10_000 });
  await addPanel.locator('sl-textarea textarea').fill(text);

  // Click the panel's Add button via a deep-DOM walk — Playwright's retry-click
  // is unstable against this overlay during the grid re-render.
  await w.evaluate(() => {
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
    const panel = findInDeepDom(document, '.add-tile-panel');
    if (!panel) throw new Error('.add-tile-panel not found in deep DOM');
    const btn = panel.querySelector('button.moss-button') as HTMLButtonElement | null;
    if (!btn) throw new Error('Add button not found in .add-tile-panel');
    btn.click();
  });
  await expect(addPanel).toBeHidden({ timeout: 10_000 });

  // Make the tile span the full width and fill the available height, so the
  // group home reads as a real description banner rather than a small box.
  // Width is a gridstack resize (the next save reads w/h back out of the
  // grid); height is the per-tile "fill height" toggle (the same control the
  // tile header's expand button drives). Both lean on group-dashboard's own
  // runtime shape — esbuild's minify doesn't rename class members.
  await w.evaluate(() => {
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
    const dash = findInDeepDom(document, 'group-dashboard') as
      | (Element & {
          _draftTiles?: Array<{ id: string; fillHeight?: boolean }>;
          _grid?: {
            update(el: Element, opts: { x?: number; w?: number }): void;
            engine?: { nodes?: Array<{ id?: string | number; el?: Element }> };
          };
          _toggleTileFillHeight?: (id: string) => void;
        })
      | null;
    const tiles = dash?._draftTiles ?? [];
    if (!dash || tiles.length === 0) throw new Error('no draft tile to size');
    const id = String(tiles[0].id);

    // Full width (12-column grid).
    const node =
      dash._grid?.engine?.nodes?.find((n) => String(n.id) === id) ??
      dash._grid?.engine?.nodes?.[0];
    if (dash._grid && node?.el) dash._grid.update(node.el, { x: 0, w: 12 });

    // Fill remaining height (toggle on if not already).
    if (!tiles[0].fillHeight && typeof dash._toggleTileFillHeight === 'function') {
      dash._toggleTileFillHeight(id);
    }
  });
  // Let the resize + fill re-render settle before saving.
  await w.waitForTimeout(400);

  // Save the dashboard; edit mode exits (header swaps Save back to the pencil).
  await w.getByRole('button', { name: /^Save$/i }).click();
  await expect(w.getByRole('button', { name: /Edit group home/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(w.locator('group-dashboard .grid-stack-item')).toHaveCount(1, {
    timeout: 15_000,
  });
}

/**
 * Open a tool's details dialog by clicking its card title in the library.
 * Scoped to installable-tools-web2 .tool-title so it never matches the
 * library's filter <select> options (which carry the same tool-name text).
 * The @click handler lives on the .tool card; clicking the title bubbles up.
 */
async function openToolCard(w: Page, toolName: string) {
  await w
    .locator('installable-tools-web2 .tool-title', { hasText: toolName })
    .first()
    .click();
}

/**
 * Drive a single install end-to-end with a defensive Custom Name fill.
 * install-tool-dialog-web2's sl-input uses .defaultValue, which only
 * initializes on first mount, so sequential installs in one session can
 * land with an empty name and a disabled submit. Detect-and-fill before
 * clicking submit.
 */
async function installTool(w: Page, toolName: string, groupName: string) {
  await openToolLibrary(w);
  // Click the tool card's title inside installable-tools-web2. why: the
  // redesigned library has a filter <select> whose <option> text matches tool
  // names, so a page-wide getByText(toolName) can resolve to a hidden option
  // and never become clickable. Scoping to the card title avoids that.
  await openToolCard(w, toolName);
  await expect(w.locator('library-tool-details')).toBeVisible({ timeout: 15_000 });
  const groupSelect = w.locator('library-tool-details select-group').first();
  await groupSelect.locator('button.install-button').click();
  await groupSelect.locator(`sl-menu-item:has-text("${groupName}")`).first().click();

  const installDialog = w.locator('install-tool-dialog-web2');
  await expect(installDialog.locator('sl-dialog[open]')).toBeVisible({ timeout: 15_000 });
  await installDialog.locator('#custom-name-field').evaluate((el, name) => {
    const sl = el as HTMLElement & { value: string };
    if (!sl.value || sl.value.trim() === '') {
      sl.value = name as string;
      sl.dispatchEvent(new Event('sl-input', { bubbles: true, composed: true }));
      sl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
  }, toolName);
  await installDialog.getByRole('button', { name: /add to group/i }).click();
  await expect(installDialog.locator('sl-dialog[open]')).toHaveCount(0, {
    timeout: 180_000,
  });
}

/**
 * Set a per-group profile on the "Enter the space" screen, resilient against
 * the join-time race where Moss briefly double-mounts moss-create-profile.
 *
 * Drives the existing enterSpaceIfPrompted helper for the actual click/save
 * path (which has been working reliably in single-agent flows), but if its
 * internal "wait for moss-create-profile count to drop to 0" stalls on the
 * race, we fall back to a real-world success check: the group-home Settings
 * button — visible to every member regardless of role — becoming present.
 */
async function setProfile(w: Page, nickname: string) {
  // group-home Settings button is visible to every member regardless of role,
  // so its presence is a reliable "profile went through" signal.
  const settings = w.locator('group-home').getByRole('button', { name: 'Settings' });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Wait out the transient double-mount before driving the form, so
    // enterSpaceIfPrompted fills the live moss-create-profile, not a stale one.
    await waitForStableProfileMount(w).catch(() => undefined);
    try {
      await enterSpaceIfPrompted(w, nickname);
      return;
    } catch (helperErr) {
      lastErr = helperErr;
      // The helper's unmount-wait can hang under the join race even when the
      // profile actually went through. If group-home is up, we're done.
      try {
        await expect(settings).toBeVisible({ timeout: 10_000 });
        return;
      } catch {
        // Otherwise let the DOM settle and try once more.
        await w.waitForTimeout(1500);
      }
    }
  }

  // Save a debug screenshot of whatever state the agent is stuck in (e.g. a
  // profile-create error). Lands in /tmp alongside Playwright's trace.
  await w
    .screenshot({ path: `/tmp/setProfile-fail-${nickname}-${Date.now()}.png`, fullPage: false })
    .catch(() => undefined);
  throw lastErr;
}

/**
 * Wait for moss-create-profile to settle to exactly one mounted instance.
 * The first-entry view can briefly double-mount it while re-rendering; driving
 * the form during that window targets the wrong instance and the success wait
 * (count → 0) then never fires.
 */
async function waitForStableProfileMount(w: Page) {
  await expect(w.locator('moss-create-profile')).toHaveCount(1, { timeout: 30_000 });
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 25 && stable < 3; i++) {
    const c = await w.locator('moss-create-profile').count();
    stable = c === 1 && c === last ? stable + 1 : 0;
    last = c;
    await w.waitForTimeout(200);
  }
}

/** Click into the group's icon in the sidebar; assert group-home is showing. */
async function enterGroup(w: Page) {
  await w.locator('groups-sidebar group-sidebar-button').first().click();
  await expect(w.locator('group-home')).toBeVisible({ timeout: 15_000 });
}

/** Reliable close for a moss-dialog: call its `.hide()` method directly. */
async function hideDialog(w: Page, dialogId: string) {
  await w.locator(`#${dialogId}`).evaluate((el) =>
    (el as { hide(): void }).hide(),
  );
  await expect(w.locator(`#${dialogId} sl-dialog[open]`)).toHaveCount(0, {
    timeout: 10_000,
  });
}

/**
 * Toggle the group-area-sidebar peers panel closed. expandPeersPanel uses
 * the same deep-DOM walk to find the toggle; here we reuse the click but
 * skip the "already open?" guard, since we want to close.
 */
async function collapsePeersPanel(w: Page) {
  if ((await w.locator('group-peers-status').count()) === 0) return;
  await w.evaluate(() => {
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
    const sidebar = findInDeepDom(document, 'group-area-sidebar');
    if (!sidebar) return;
    const root = (sidebar as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (!root) return;
    const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
    const toggle = buttons.find((b) => /online/i.test(b.textContent ?? ''));
    toggle?.click();
  });
  await expect(w.locator('group-peers-status')).toHaveCount(0, { timeout: 10_000 });
}

/** Open the group's Settings dialog from group-home. */
async function openGroupSettings(w: Page) {
  await w.locator('group-home').getByRole('button', { name: 'Settings' }).click();
  await expect(w.locator('#group-settings-dialog sl-dialog[open]')).toBeVisible({
    timeout: 15_000,
  });
}

// =============================================================================
// The single capture flow
// =============================================================================

test('guide captures', async ({ moss, secondAgent }) => {
  // ===========================================================================
  // Agent 1 (Alex): solo states + creation
  // ===========================================================================
  const w1 = moss.mainWindow;
  await waitForBoot(w1, 90_000);
  await startFreshIfLegacyImport(w1);
  await prepareForCapture(w1);

  // ---- home-screen --------------------------------------------------------
  await shot(w1, 'home-screen');

  // ---- add-group-dialog ---------------------------------------------------
  await w1.locator('groups-sidebar').getByRole('button', { name: 'Add Group' }).click();
  await shotDialog(w1, 'add-group-dialog', '#add-group-dialog sl-dialog[open]');

  // ---- create-group-dialog (the form before submitting) -------------------
  await w1.getByRole('button', { name: /create group/i }).click();
  await expect(w1.locator('#add-group-dialog sl-dialog[open]')).toHaveCount(0, {
    timeout: 10_000,
  });
  await shotDialog(w1, 'create-group-dialog', 'create-group-dialog sl-dialog[open]');
  await w1.keyboard.press('Escape');
  await expect(w1.locator('create-group-dialog sl-dialog[open]')).toHaveCount(0, {
    timeout: 10_000,
  });

  // ---- group-created (empty group, just-after-create, alone) --------------
  await createGroupFromMainDashboard(w1, { ...GROUP, nickname: ALEX });
  await setProfile(w1, ALEX);
  await expect(w1.locator('groups-sidebar group-sidebar-button')).toHaveCount(1, {
    timeout: 30_000,
  });
  await w1.waitForTimeout(500);
  await shot(w1, 'group-created');

  // Seed the dashboard with a description tile while it's still just Alex.
  await seedGroupDashboard(w1, GROUP_DESCRIPTION);

  // ---- group-dashboard (populated tile dashboard) -------------------------
  await w1.waitForTimeout(500);
  await shot(w1, 'group-dashboard');

  // Generate the invite link the joiners need.
  const link = await getCurrentGroupInviteLink(w1);

  // ===========================================================================
  // Agent 2 (Sam): boot, capture the join dialog mid-fill, complete the join
  // ===========================================================================
  const a2 = await secondAgent();
  const w2 = a2.mainWindow;
  await waitForBoot(w2, 90_000);
  await startFreshIfLegacyImport(w2);
  await prepareForCapture(w2);

  await w2.getByRole('button', { name: 'Add Group' }).click();
  await w2.getByRole('button', { name: /join group/i }).first().click();
  const joinDialog = w2.locator('join-group-dialog');
  await expect(w2.locator('join-group-dialog sl-dialog[open]')).toBeVisible({
    timeout: 10_000,
  });
  await joinDialog.getByLabel(/invite link/i).fill(link);
  await shotDialog(w2, 'join-group-dialog', 'join-group-dialog sl-dialog[open]');

  // Submit the dialog directly (don't re-run joinGroupByInviteLink — that
  // would try to re-open Add Group from scratch).
  await joinDialog.locator('button[type="submit"]').click();
  await expect(joinDialog.locator('sl-dialog[open]')).toHaveCount(0, {
    timeout: 120_000,
  });
  // Brief settle: after the join dialog closes Moss can briefly mount
  // moss-create-profile twice while the first-entry view re-renders. Give
  // it a beat before enterSpaceIfPrompted goes looking for the form.
  await w2.waitForTimeout(1500);
  await setProfile(w2, SAM);

  // Wait for Agent 1 to see Agent 2 before launching Agent 3. A serial
  // join-then-converge is more reliable than two near-simultaneous joins —
  // when agent 3 joins into a group whose members are already converged,
  // its profile-create write succeeds first try. (expectPeerCount opens
  // the peers panel on w1 as a side effect; close it again afterwards so
  // it doesn't pollute later captures.)
  await enterGroup(w1);
  await expectPeerCount(w1, 2, 120_000);
  await collapsePeersPanel(w1);

  // ===========================================================================
  // Agent 3 (Robin): boot, join quietly
  // ===========================================================================
  const a3 = await secondAgent();
  const w3 = a3.mainWindow;
  await waitForBoot(w3, 90_000);
  await startFreshIfLegacyImport(w3);
  await joinGroupByInviteLink(w3, link);
  await w3.waitForTimeout(1500);
  await setProfile(w3, ROBIN);

  // ===========================================================================
  // Back to Agent 1: wait for both peers to be discovered, then drive the
  // rest of the captures from a populated group.
  // ===========================================================================
  await enterGroup(w1);
  await expectPeerCount(w1, 3, 120_000);

  // expectPeerCount left the peers panel open — perfect for peer-status-panel.
  await w1.waitForTimeout(800);
  await shot(w1, 'peer-status-panel');
  // Collapse the panel before continuing: it has its own Invite People
  // button which otherwise collides with the group-home one below.
  await collapsePeersPanel(w1);

  // ---- invite-people-dialog ----------------------------------------------
  await w1.locator('group-home').getByRole('button', { name: 'Invite People' }).click();
  await shotDialog(w1, 'invite-people-dialog', 'invite-people-dialog sl-dialog[open]');
  await w1.keyboard.press('Escape');
  await expect(w1.locator('invite-people-dialog sl-dialog[open]')).toHaveCount(0, {
    timeout: 10_000,
  });

  // ---- group settings → Members / My Profile / Danger Zone ----------------
  await openGroupSettings(w1);
  await w1.locator('group-settings').getByRole('button', { name: 'Members' }).click();
  await shotDialog(w1, 'group-members-roles', '#group-settings-dialog sl-dialog[open]');

  await w1.locator('group-settings').getByRole('button', { name: 'My Profile' }).click();
  await expect(w1.locator('#group-settings my-profile-settings')).toBeVisible({
    timeout: 10_000,
  });
  await shotDialog(w1, 'profile-per-group', '#group-settings-dialog sl-dialog[open]');

  await w1.locator('group-settings').getByRole('button', { name: 'Danger Zone' }).click();
  await shotDialog(w1, 'group-danger-zone', '#group-settings-dialog sl-dialog[open]');
  await hideDialog(w1, 'group-settings-dialog');

  // ---- moss settings tabs -------------------------------------------------
  await openSettings(w1);
  await expect(w1.locator('moss-settings')).toBeVisible({ timeout: 10_000 });

  await w1
    .locator('moss-settings')
    .getByRole('button', { name: 'Profile', exact: true })
    .click();
  await expect(w1.locator('moss-profile-settings')).toBeVisible({ timeout: 10_000 });
  await shotDialog(w1, 'profile-global', '#settings-dialog sl-dialog[open]');

  await w1.locator('moss-settings').getByRole('button', { name: 'Notifications' }).click();
  await expect(w1.locator('moss-notification-sound-settings')).toBeVisible({
    timeout: 10_000,
  });
  await shotDialog(w1, 'notification-sounds', '#settings-dialog sl-dialog[open]');

  await openLanguageTab(w1);
  await shotDialog(w1, 'settings-language', '#settings-dialog sl-dialog[open]');

  await w1
    .locator('moss-settings')
    .getByRole('button', { name: 'Danger Zone', exact: true })
    .click();
  await expect(w1.locator('moss-danger-zone-settings')).toBeVisible({ timeout: 10_000 });
  await shotDialog(w1, 'moss-danger-zone', '#settings-dialog sl-dialog[open]');
  await hideDialog(w1, 'settings-dialog');

  // ---- tool-library + tool-details-dialog --------------------------------
  await openToolLibrary(w1);
  await shot(w1, 'tool-library');
  // KanDo's detail dialog is the one we want for this shot. Click its card
  // title (scoped to the cards, not the library's filter <select> options).
  await openToolCard(w1, 'KanDo');
  await expect(w1.locator('library-tool-details')).toBeVisible({ timeout: 15_000 });
  await w1.waitForTimeout(DIALOG_SETTLE_MS);
  await shot(w1, 'tool-details-dialog');
  await w1.keyboard.press('Escape');

  // ---- install Emergence first, disable it so the final toast is from
  //      Vines ("Installation successful") not "Tool disabled" ------------
  await installTool(w1, 'Emergence', GROUP.name);
  await enterGroup(w1);
  await openGroupSettings(w1);
  await w1.locator('group-settings').getByRole('button', { name: 'Group Tools' }).click();
  await w1.locator('applet-settings-card:has-text("Emergence") sl-switch').click();
  await w1.waitForTimeout(600);
  await hideDialog(w1, 'group-settings-dialog');

  // ---- install the rest in reverse order ----------------------------------
  for (const toolName of TOOLS_TO_INSTALL_AFTER_EMERGENCE) {
    await installTool(w1, toolName, GROUP.name);
  }
  await enterGroup(w1);

  // ---- tool-installed-in-group -------------------------------------------
  await shot(w1, 'tool-installed-in-group');

  // ---- group-tools-settings (Active sub-tab; Emergence still disabled) ---
  await openGroupSettings(w1);
  await w1.locator('group-settings').getByRole('button', { name: 'Group Tools' }).click();
  await w1.waitForTimeout(500);
  await shotDialog(w1, 'group-tools-settings', '#group-settings-dialog sl-dialog[open]');
  await hideDialog(w1, 'group-settings-dialog');

  // ---- pocket -------------------------------------------------------------
  // Captured last, once the group has tools installed — showing the Pocket
  // against a populated group reads better than an empty just-created one.
  await enterGroup(w1);
  await w1.keyboard.press('Alt+s');
  await shotDialog(w1, 'pocket', '#pocket sl-dialog[open]');
  await hideDialog(w1, 'pocket');
});
