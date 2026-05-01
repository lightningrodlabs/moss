import { Page, expect } from '@playwright/test';

/**
 * Helpers for the settings / profile / language flows under
 * src/renderer/src/elements/_new_design/moss-settings/.
 */

/**
 * Open the settings dialog from main-dashboard. The gear button is icon-only
 * but we set aria-label="Settings" on it (see main-dashboard.ts) so role-based
 * lookup works.
 */
export async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).first().click();
}

/**
 * Switch to the Language tab in moss-settings. Tabs are plain <button class="tab">
 * with msg() text content, not role="tab" — so we look up by the button name.
 */
export async function openLanguageTab(page: Page) {
  await page.locator('moss-settings').getByRole('button', { name: /language|sprache|langue|idioma|dil/i }).click();
}

/**
 * Pick a locale by its short code (e.g. 'de', 'fr', 'es'). The picker is a
 * native <select id="locale-select"> inside <moss-language-settings>.
 */
export async function selectLocale(page: Page, locale: string) {
  await page.locator('moss-language-settings #locale-select').selectOption(locale);
}

export async function expectLocalizedString(page: Page, expected: RegExp) {
  await expect(page.getByText(expected)).toBeVisible({ timeout: 10_000 });
}
