import { Page } from '@playwright/test';
import { waitForState } from './bootToReady';

/**
 * Helpers for group creation / joining flows.
 *
 * These are intentionally functional (not classes) — see the philosophy section
 * of plans/ui-testing-and-cruft-cleanup.md for why.
 *
 * NOTE: these are skeletons matching the smoke-suite intent. The first time each
 * is exercised against a real build, the locators will need tightening based on
 * what the renderer actually exposes. Prefer role-based locators; reach for
 * data-testid only on opaque elements with no semantic role.
 */

export type CreateGroupOptions = {
  name: string;
  /** Path to an avatar image on disk, optional. */
  avatarPath?: string;
};

export async function createGroupFromInitialSetup(page: Page, opts: CreateGroupOptions) {
  // Initial-setup view → "Create group" → step 1 (name + avatar) → step 2 → CreatingGroup → Running
  await waitForState(page, ['InitialSetup']);
  await page.getByRole('button', { name: /create.*group/i }).click();

  await waitForState(page, ['CreateGroupStep1']);
  await page.getByLabel(/group name/i).fill(opts.name);
  if (opts.avatarPath) {
    // Avatar selection uses a file input under <moss-select-avatar>. Locator
    // tightened on first real run.
    await page.locator('input[type="file"]').setInputFiles(opts.avatarPath);
  }
  await page.getByRole('button', { name: /next|continue/i }).click();

  await waitForState(page, ['CreateGroupStep2']);
  await page.getByRole('button', { name: /create|finish|done/i }).click();

  // CreatingGroup → Running
  await waitForState(page, ['Running'], 90_000);
}

export async function joinGroupByInviteLink(page: Page, inviteLink: string) {
  await waitForState(page, ['InitialSetup', 'Running']);
  // The "join by invite" entry point lives in initial setup and in the groups sidebar.
  // Locator tightened on first real run.
  await page.getByRole('button', { name: /join.*group/i }).click();
  await page.getByLabel(/invite.*link/i).fill(inviteLink);
  await page.getByRole('button', { name: /join/i }).click();
  await waitForState(page, ['Running'], 120_000);
}

/**
 * Read an invite link for the current group from the first-agent UI.
 * Returns the link string. Used by smoke #9 to bootstrap the second agent.
 */
export async function getCurrentGroupInviteLink(page: Page): Promise<string> {
  // why: there is no programmatic surface for this yet — pulling from clipboard
  // after clicking "copy invite" is the realistic path. To be filled in once
  // the smoke suite first exercises it; throw early so it's obvious in failures.
  throw new Error('getCurrentGroupInviteLink: not yet implemented — wire up on first use');
}
