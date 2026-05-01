import { Page, FrameLocator, expect } from '@playwright/test';

/**
 * Helpers for tool-library / applet flows. Skeletons — locators tighten on first
 * real run. Keep these functional and small.
 */

export type InstallToolOptions = {
  /** Display name shown in the tool library UI. */
  toolName: string;
};

/**
 * Install a tool from the in-app tool library. Assumes the user is already in a
 * group (Running state, group selected).
 *
 * Smoke #4 verifies that after this completes, the tool is listed inside the
 * group pane (the new design — *not* across the top of the main page).
 */
export async function installToolFromLibrary(page: Page, opts: InstallToolOptions) {
  // Open tool library from the group pane. The "Add tool" / "Install tool" button
  // lives somewhere in the new-design group pane — locator tightened on first run.
  await page.getByRole('button', { name: /add.*tool|install.*tool|tool.*library/i }).first().click();
  await page.getByRole('button', { name: new RegExp(opts.toolName, 'i') }).click();
  await page.getByRole('button', { name: /install/i }).click();
  await expect(page.getByText(new RegExp(opts.toolName, 'i'))).toBeVisible({ timeout: 60_000 });
}

/**
 * Click the tool in the group pane and wait for the applet iframe to mount.
 * Returns a FrameLocator for the iframe contents.
 */
export async function openToolInGroup(page: Page, toolName: string): Promise<FrameLocator> {
  await page.getByRole('button', { name: new RegExp(toolName, 'i') }).first().click();
  // Applet iframe lives inside the main view-frame. Tighten on first run.
  return page.frameLocator('iframe.applet-iframe, iframe[src*="applet"]').first();
}

/**
 * Smoke #5: assert the WeaveClient handshake completed inside the iframe by
 * waiting for a marker the applet renders post-handshake. The example applet
 * needs a deterministic marker for this to work — TODO: add `data-weave-ready`
 * attribute on the applet's root once we wire this up.
 */
export async function waitForAppletHandshake(frame: FrameLocator, timeoutMs = 30_000) {
  await expect(frame.locator('[data-weave-ready]')).toBeVisible({ timeout: timeoutMs });
}

/**
 * Smoke #9: verify the current agent appears in the group's peer list. Run this
 * against the *first* agent's window after the second agent has joined.
 *
 * The group peer list lives in the group pane sidebar in the new design.
 * Locator tightened on first real run.
 */
export async function expectPeerCount(page: Page, atLeast: number, timeoutMs = 60_000) {
  // Polling because peer discovery is async over gossip.
  await expect
    .poll(
      async () => {
        const peers = await page.locator('[data-peer-list] [data-peer]').count();
        return peers;
      },
      { timeout: timeoutMs, message: `Expected at least ${atLeast} peers in group peer-list` },
    )
    .toBeGreaterThanOrEqual(atLeast);
}
