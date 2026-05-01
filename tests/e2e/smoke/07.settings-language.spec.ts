import { test, expect } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { openLanguageTab, openSettings, selectLocale } from '../helpers/settings';

/**
 * Smoke #7 — Change UI language via settings.
 *
 * why: exercises _new_design/moss-settings/ + the @lit/localize runtime path.
 * The translation pipeline (extract → xliff → build) is core infrastructure;
 * if a refactor accidentally breaks runtime locale switching this catches it.
 *
 * Verification: switch to German and assert the Language tab label itself
 * re-renders as "Sprache" (its translated value, see xliff/de.xlf).
 */
test('change UI language to German and re-render translated strings', async ({ moss }) => {
  await waitForBoot(moss.mainWindow, 90_000);
  await startFreshIfLegacyImport(moss.mainWindow);

  await openSettings(moss.mainWindow);
  await openLanguageTab(moss.mainWindow);

  // Sanity: before the switch, the Language tab reads "Language" (English source).
  await expect(
    moss.mainWindow.locator('moss-settings').getByRole('button', { name: 'Language' }),
  ).toBeVisible();

  await selectLocale(moss.mainWindow, 'de');

  // After: the same tab now reads "Sprache" — proves the runtime setLocale
  // dispatched and the @localized() decorator re-rendered translated msg() calls.
  await expect(
    moss.mainWindow.locator('moss-settings').getByRole('button', { name: 'Sprache' }),
  ).toBeVisible({ timeout: 10_000 });
});
