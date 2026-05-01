import { Page, expect } from '@playwright/test';

/**
 * Helpers for the settings / profile / language flows under
 * src/renderer/src/elements/_new_design/moss-settings/.
 */

export async function openSettings(page: Page) {
  await page.getByRole('button', { name: /settings/i }).first().click();
}

export async function changeLanguage(page: Page, languageLabel: RegExp) {
  await openSettings(page);
  await page.getByRole('tab', { name: /language|locale/i }).click();
  await page.getByRole('radio', { name: languageLabel }).click();
}

export async function expectLocalizedString(page: Page, expected: RegExp) {
  await expect(page.getByText(expected)).toBeVisible({ timeout: 10_000 });
}
