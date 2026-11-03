import { Page, FrameLocator, expect } from '@playwright/test';

/**
 * Helpers for tool-library / applet flows. Skeletons — locators tighten on first
 * real run. Keep these functional and small.
 */

export type InstallToolOptions = {
  /** Display name shown in the tool library UI. */
  toolName: string;
  /** Group display name. The tool list shows a select-group dropdown per tool. */
  groupName: string;
  /**
   * Values for the Tool's declared install options, keyed by the option's
   * label. Each is typed into the matching field of the install dialog. A
   * required field's accessible name also carries a trailing `*`, so the
   * label is matched as a substring.
   */
  installOptions?: Record<string, string>;
};

/**
 * Open the in-app Tool Library by clicking the sidebar button. Locator is the
 * sl-tooltip wrapping the moss-sidebar-button — see main-dashboard.ts:1596.
 */
export async function openToolLibrary(page: Page) {
  await page.getByRole('button', { name: 'Tool Library' }).click();
  // why: tool-library fetches curation lists asynchronously in firstUpdated;
  // wait for at least one tool card before we try to click one.
  await expect(page.locator('installable-tools')).toBeVisible({ timeout: 30_000 });
}

/**
 * Install a tool from the in-app tool library into the named group. Assumes
 * the user is already in Running state and the group exists.
 *
 * Smoke #4 verifies that after this completes, the tool is listed inside the
 * group pane (the new design — *not* across the top of the main page).
 */
export async function installToolFromLibrary(page: Page, opts: InstallToolOptions) {
  await openInstallDialog(page, opts);
  await submitInstallDialog(page, opts.installOptions ?? {});
}

/**
 * Open the install dialog for a tool from the in-app tool library, targeting
 * the named group. Leaves the dialog open and unsubmitted.
 */
export async function openInstallDialog(page: Page, opts: InstallToolOptions) {
  await openToolLibrary(page);
  // Click the tool card by title — opens the tool detail dialog (library-tool-details).
  await page.getByText(opts.toolName, { exact: false }).first().click();
  // why: target the dialog's <select-group> rather than the hover-only one
  // on the card itself. The card's select-group has class="show-on-hover"
  // (visibility: hidden until hover); the dialog's one is always visible.
  // <library-tool-details> is rendered inside the moss-dialog opened above.
  const dialogSelect = page.locator('library-tool-details select-group').first();
  await dialogSelect.locator('button.install-button').click();
  await dialogSelect.locator(`sl-menu-item:has-text("${opts.groupName}")`).first().click();
  await expect(addToGroupButton(page)).toBeVisible();
}

/** The install dialog's "Add to Group" submit button. */
export function addToGroupButton(page: Page) {
  return page.locator('install-tool-dialog').getByRole('button', { name: /add to group/i });
}

/**
 * Fill the install options in the open install dialog, submit it, and wait
 * for the install to finish.
 */
export async function submitInstallDialog(page: Page, installOptions: Record<string, string>) {
  const form = page.locator('install-tool-dialog install-options-form');
  for (const [label, value] of Object.entries(installOptions)) {
    await form.getByLabel(label).fill(value);
  }
  await addToGroupButton(page).click();
  // why: install includes a webhapp download + DNA registration; can take a while
  // even from a localhost fixture (lair signing, conductor admin calls, gossip).
  // The <install-tool-dialog> host never has a box of its own, so the dialog
  // closing is observed through its submit button.
  await expect(addToGroupButton(page)).toBeHidden({ timeout: 120_000 });
}

/**
 * Click the tool in the group pane and wait for the applet iframe to mount.
 * Returns a FrameLocator for the iframe contents.
 */
export async function openToolInGroup(page: Page, toolName: string): Promise<FrameLocator> {
  await page
    .getByRole('button', { name: new RegExp(toolName, 'i') })
    .first()
    .click();
  // Applet iframe lives inside the main view-frame. Tighten on first run.
  return page.frameLocator('iframe.applet-iframe, iframe[src*="applet"]').first();
}

/**
 * Smoke #5: assert the WeaveClient handshake completed inside the iframe by
 * waiting for the [data-weave-ready] marker the example applet sets on its
 * host element once renderInfo is set (see example/ui/src/example-applet.ts).
 */
export async function waitForAppletHandshake(frame: FrameLocator, timeoutMs = 30_000) {
  await expect(frame.locator('[data-weave-ready]')).toBeVisible({ timeout: timeoutMs });
}

/**
 * Open the popped-out peers panel in group-area-sidebar if it isn't already.
 * Idempotent — safe to call before each peer-count assertion.
 *
 * why: <group-peers-status> only mounts when the popped-out panel is open
 * (onlinePeersCollapsed === true in group-area-sidebar.ts:808). The default
 * state is closed, so the panel must be toggled to make the peer list visible
 * to the test.
 */
export async function expandPeersPanel(page: Page) {
  if ((await page.locator('group-peers-status').count()) > 0) return;
  // why: the toggle button shows "<count>/<total> online" but the count parts
  // are nested in <span>s with their own opacity styling, so Playwright's
  // computed accessible name can be unstable. We resolve by deep-DOM walk:
  // find group-area-sidebar, then its button whose text contains "online".
  await page.evaluate(() => {
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
    if (!sidebar) throw new Error('group-area-sidebar not found');
    const root = (sidebar as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (!root) throw new Error('group-area-sidebar has no shadow root');
    const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
    const toggle = buttons.find((b) => /online/i.test(b.textContent ?? ''));
    if (!toggle) throw new Error('peers toggle button not found');
    toggle.click();
  });
  // why: the panel is positioned absolutely and the host may report 0×0 even
  // when children render. We just need it mounted in the DOM so the peer-row
  // count locator can find rows; visibility doesn't matter for the test signal.
  await expect(page.locator('group-peers-status')).toHaveCount(1, { timeout: 10_000 });
}

/**
 * Smoke #9: verify the current group's peer list reaches at least `atLeast` rows.
 *
 * Renders inside <group-peers-status> in the active group pane. Each peer is
 * rendered as `<div class="row profile">` (see groups/elements/group-peers-status.ts).
 * Self counts as one peer. Auto-expands the peers panel if needed.
 *
 * why: peer discovery happens over async gossip — when agent 2 joins a group,
 * agent 1's view doesn't immediately learn about them. Poll instead of assert.
 */
export async function expectPeerCount(page: Page, atLeast: number, timeoutMs = 90_000) {
  await expandPeersPanel(page);
  await expect
    .poll(async () => page.locator('group-peers-status div.row.profile').count(), {
      timeout: timeoutMs,
      message: `Expected at least ${atLeast} peers in group peer-list`,
    })
    .toBeGreaterThanOrEqual(atLeast);
}
