import { test, expect } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';

/**
 * Smoke #15 — A link to an external location opens outside Moss.
 *
 * why: a plain link to a web page in the Moss UI must open in the system's
 * default browser and leave the Moss window as it is. The spec stubs
 * shell.openExternal in the main process and marks the page, so a reload
 * would clear the mark.
 */
test('clicking an external link opens it outside Moss and keeps the window', async ({ moss }) => {
  await waitForBoot(moss.mainWindow, 90_000);
  await startFreshIfLegacyImport(moss.mainWindow);

  await moss.app.evaluate(({ shell }) => {
    (globalThis as any).__openedExternally = [];
    shell.openExternal = async (url: string) => {
      (globalThis as any).__openedExternally.push(url);
    };
  });

  const url = 'https://example.org/moss-e2e';
  await moss.mainWindow.evaluate((href) => {
    (window as any).__pageMark = 'kept';
    const link = document.createElement('a');
    link.href = href;
    link.id = 'e2e-external-link';
    link.textContent = 'external';
    link.style.cssText =
      'position: fixed; top: 0; left: 0; z-index: 2147483647; background: white;';
    document.body.appendChild(link);
  }, url);
  // why: the main process prevents the navigation and opens the link
  // externally, so there is no navigation for the click to wait for.
  await moss.mainWindow.locator('#e2e-external-link').click({ noWaitAfter: true });

  await expect
    .poll(() => moss.app.evaluate(() => (globalThis as any).__openedExternally), { timeout: 5_000 })
    .toEqual([url]);
  // Long enough for a reload to have replaced the page.
  await moss.mainWindow.waitForTimeout(1500);
  expect(await moss.mainWindow.evaluate(() => (window as any).__pageMark)).toBe('kept');
});
