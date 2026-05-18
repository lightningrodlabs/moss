import { test, expect } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { createGroupFromMainDashboard } from '../helpers/groups';

/**
 * Smoke #6 — Switch between two groups via the groups-sidebar.
 *
 * why: locks down the navigation surface that replaced the old top-of-page
 * tools listing. If a refactor breaks group-switching this catches it.
 *
 * Approach: create two groups, then click between their sidebar buttons and
 * assert the `selected` class on the inner sidebar-button moves to whichever
 * group was clicked. Each group-sidebar-button renders an <img alt="Group Name">
 * which we use to identify which is which (no role-based label is available
 * for the host element).
 */
test('creating two groups and clicking between them moves the selected indicator', async ({
  moss,
}) => {
  await waitForBoot(moss.mainWindow, 90_000);
  await startFreshIfLegacyImport(moss.mainWindow);

  await createGroupFromMainDashboard(moss.mainWindow, { name: 'Alpha' });
  await createGroupFromMainDashboard(moss.mainWindow, { name: 'Beta' });

  const buttons = moss.mainWindow.locator('groups-sidebar group-sidebar-button');
  await expect(buttons).toHaveCount(2);

  const alphaImg = moss.mainWindow.locator('groups-sidebar img[alt="Alpha"]').first();
  const betaImg = moss.mainWindow.locator('groups-sidebar img[alt="Beta"]').first();

  // After creating Beta it should be the selected group. Verify by walking from
  // the img up to the inner <button class="icon-container ... selected">.
  // why: <sidebar-button> sets the `selected` class on its inner button — see
  // navigation/sidebar-button.ts:61. That's the DOM signal for "this is the
  // active group".
  const alphaContainer = alphaImg.locator('xpath=ancestor::button[contains(@class,"icon-container")]');
  const betaContainer = betaImg.locator('xpath=ancestor::button[contains(@class,"icon-container")]');

  await expect(betaContainer).toHaveClass(/(?:^|\s)selected(?:\s|$)/);

  // Click Alpha → it becomes selected, Beta loses selection.
  await alphaImg.click();
  await expect(alphaContainer).toHaveClass(/(?:^|\s)selected(?:\s|$)/);
  await expect(betaContainer).not.toHaveClass(/(?:^|\s)selected(?:\s|$)/);

  // Click Beta → selection moves back.
  await betaImg.click();
  await expect(betaContainer).toHaveClass(/(?:^|\s)selected(?:\s|$)/);
  await expect(alphaContainer).not.toHaveClass(/(?:^|\s)selected(?:\s|$)/);
});
