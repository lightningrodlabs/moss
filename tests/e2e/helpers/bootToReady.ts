import { Page, expect } from '@playwright/test';

/**
 * The set of MossAppState names we treat as "the app booted successfully".
 * `Loading` is intentionally *not* in this set — Loading is the transient
 * pre-state we want to wait past.
 *
 * `InitialSetup` is the expected steady state for a fresh profile.
 * `Running` is the expected steady state for a profile that already has groups.
 */
export const READY_STATES = [
  'InitialSetup',
  'Running',
  'CreateGroupStep1',
  'LegacyKeystoreImport',
] as const;

export type MossStateName =
  | 'Loading'
  | 'LegacyKeystoreImport'
  | 'InitialSetup'
  | 'CreateGroupStep1'
  | 'CreateGroupStep2'
  | 'CreatingGroup'
  | 'JoiningGroup'
  | 'Error'
  | 'Running';

/**
 * Wait until <moss-app data-state="..."> reflects one of the given states.
 * Returns the actual state name.
 *
 * The state attribute is reflected from the renderer's MossAppState enum —
 * see src/renderer/src/moss-app.ts:updated().
 */
export async function waitForState(
  page: Page,
  states: readonly MossStateName[],
  timeoutMs = 60_000,
): Promise<MossStateName> {
  const selector = states.map((s) => `moss-app[data-state="${s}"]`).join(', ');
  await page.waitForSelector(selector, { timeout: timeoutMs });
  const handle = await page.$('moss-app');
  const state = (await handle?.getAttribute('data-state')) as MossStateName | null;
  if (!state) {
    throw new Error('moss-app element disappeared after waitForSelector resolved');
  }
  return state;
}

/**
 * Convenience: wait for the app to leave Loading. Use this in the spike test
 * and as the first step of every smoke test.
 */
export async function waitForBoot(page: Page, timeoutMs = 60_000): Promise<MossStateName> {
  return waitForState(page, READY_STATES, timeoutMs);
}

/**
 * If the app is on the legacy-keystore-import screen (which it can be on a fresh
 * profile when prior versions of Moss have left data on disk), click "Start
 * Fresh" so we land on InitialSetup. Idempotent — does nothing if not on that
 * screen.
 *
 * why: smoke tests should always exercise the new fresh-profile path. Importing
 * from a previous version is a separate test surface, intentionally deferred —
 * see plans/ui-testing-and-cruft-cleanup.md Phase 4.
 */
export async function startFreshIfLegacyImport(page: Page): Promise<MossStateName> {
  // Quick check: are we on the import screen?
  const isImport = await page.locator('moss-app[data-state="LegacyKeystoreImport"]').count();
  if (isImport === 0) {
    // Not on import screen — read whatever state we're in and return it.
    const handle = await page.$('moss-app');
    return ((await handle?.getAttribute('data-state')) ?? 'Loading') as MossStateName;
  }
  // Locator may need tightening on first real run — the Start Fresh control lives
  // inside the import dialog. Role-based first; fall back to text.
  const startFresh = page.getByRole('button', { name: /start.*fresh|skip|don.?t import/i });
  await startFresh.first().click();
  // why: after Start Fresh, moss-app loops back to Loading and continues setup —
  // lair init, conductor boot, admin-websocket connect, listApps, then either
  // InitialSetup (packaged + no legacy + no groups) or Running. On the user's
  // machine with multiple prior Moss versions on disk this can take ~60s under
  // suite load, so we allow up to 120s.
  return waitForState(page, ['InitialSetup', 'Running'], 120_000);
}

/**
 * Stronger guarantee: wait for state === 'Running' (has groups, main-dashboard mounted).
 * Used by tests that assume an existing profile with at least one group.
 */
export async function waitForRunning(page: Page, timeoutMs = 60_000): Promise<void> {
  await waitForState(page, ['Running'], timeoutMs);
  await expect(page.locator('main-dashboard')).toBeVisible();
}
