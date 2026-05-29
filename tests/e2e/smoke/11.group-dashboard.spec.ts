import { Page } from '@playwright/test';
import { test, expect } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { createGroupFromMainDashboard, enterSpaceIfPrompted } from '../helpers/groups';

/**
 * Smoke #11 — Group home dashboard.
 *
 * why: locks down the new tile-based group home (group-dashboard.ts). Verifies
 * the steward edit flow (enter edit mode → add markdown tile → add image tile
 * → save → persist) and the gridstack-y-overflow regression: adding a SECOND
 * tile after the first used to set `y: Number.MAX_SAFE_INTEGER` as a "place at
 * bottom" sentinel, which made GridStack.init hang on the re-init pass and
 * froze the entire page. The markdown→image flow exercises exactly that path.
 *
 * Asset (WAL) tile coverage is intentionally OUT of scope here: <wal-element>
 * gates its click handler on assetInfo resolving, which requires a real applet
 * to publish the WAL. That belongs in the slow suite, alongside an example-
 * applet install. The dashboard's WAL-tile add path itself is identical to the
 * markdown/image path (same `_addTile`, same gridstack interaction), so this
 * smoke test still locks in the underlying regression.
 */

/**
 * Click the Add button in the dashboard's add-tile overlay.
 *
 * why: walk through nested shadow roots (main-dashboard → group-home →
 * group-dashboard's light DOM) and call .click() on the native button directly.
 * Playwright's normal click had stability-retry trouble against this overlay
 * during the markdown→image re-render.
 */
async function clickAddTileDialogAdd(page: Page) {
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
    const panel = findInDeepDom(document, '.add-tile-panel');
    if (!panel) throw new Error('.add-tile-panel not found in deep DOM');
    const btn = panel.querySelector('button.moss-button') as HTMLButtonElement | null;
    if (!btn) throw new Error('Add button not found in .add-tile-panel');
    btn.click();
  });
}

async function openGroupHome(page: Page, groupName: string, nickname: string) {
  await waitForBoot(page, 90_000);
  await startFreshIfLegacyImport(page);
  await createGroupFromMainDashboard(page, { name: groupName });
  await enterSpaceIfPrompted(page, nickname);
}

async function enterDashboardEditMode(page: Page) {
  const dashboard = page.locator('group-dashboard');
  await expect(dashboard).toBeVisible({ timeout: 60_000 });

  // Edit / Save / Cancel / Add-tile buttons now live in group-home's header
  // row (next to Invite People / Settings) rather than inside group-dashboard,
  // so we look for them at the page scope. Buttons are icon-only — accessible
  // name comes from a native `title` attribute.
  const editBtn = page.getByRole('button', { name: /Edit group home/i });
  await expect(editBtn).toBeVisible({ timeout: 30_000 });
  await editBtn.click();

  const addTileBtn = page.getByRole('button', { name: /Add tile/i });
  await expect(addTileBtn).toBeVisible({ timeout: 10_000 });
  return { dashboard, addTileBtn };
}

test('steward can add markdown and image tiles to the group home dashboard', async ({
  moss,
}) => {
  await openGroupHome(moss.mainWindow, 'Dashboard Test', 'steward-one');
  const page = moss.mainWindow;
  const { dashboard, addTileBtn } = await enterDashboardEditMode(page);

  // The add-tile overlay is a plain DOM element conditionally rendered when
  // _addDialogOpen is true. Open == "present in DOM".
  const addDialog = page.locator('.add-tile-panel');

  // ---- Markdown ----
  await addTileBtn.click();
  // why: wait for the sl-dropdown to actually open before clicking the
  // menuitem — the menu mounts on a microtask after the trigger click and a
  // tight click sequence can outrace it.
  await expect(page.getByRole('menuitem', { name: /^Markdown$/i })).toBeVisible({
    timeout: 5_000,
  });
  await page.getByRole('menuitem', { name: /^Markdown$/i }).click({ force: true });
  await expect(addDialog).toBeVisible({ timeout: 10_000 });
  // why: sl-textarea's label lives in its shadow DOM, so Playwright's
  // getByLabel can't find it. Target the inner native <textarea> instead —
  // Playwright pierces shadow roots for CSS locators by default.
  await addDialog
    .locator('sl-textarea textarea')
    .fill('# Hello dashboard\n\nThis is a markdown tile.');
  await clickAddTileDialogAdd(page);
  await expect(addDialog).toBeHidden({ timeout: 10_000 });

  // ---- Image ----
  // why: this second add reproduces the gridstack y-overflow freeze. Before
  // the fix in group-dashboard.ts, the new tile was inserted with
  // `y: Number.MAX_SAFE_INTEGER` (a "place at bottom" sentinel) and the
  // grid's re-init step hung the page.
  await addTileBtn.click();
  await expect(page.getByRole('menuitem', { name: /^Image$/i })).toBeVisible({
    timeout: 5_000,
  });
  await page.getByRole('menuitem', { name: /^Image$/i }).click({ force: true });
  await expect(addDialog).toBeVisible({ timeout: 10_000 });
  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  await addDialog.locator('sl-input input').nth(0).fill(tinyPng);
  await addDialog.locator('sl-input input').nth(1).fill('tile image');
  await clickAddTileDialogAdd(page);
  await expect(addDialog).toBeHidden({ timeout: 10_000 });

  await expect(dashboard.locator('.grid-stack-item')).toHaveCount(2);

  // ---- Save & verify persistence ----
  // Save lives in group-home's header now, not inside group-dashboard.
  await page.getByRole('button', { name: /^Save$/i }).click();
  await expect(addTileBtn).toBeHidden({ timeout: 30_000 });
  await expect(dashboard.locator('.grid-stack-item')).toHaveCount(2, { timeout: 15_000 });
  await expect(
    dashboard.locator('.markdown-tile h1', { hasText: 'Hello dashboard' }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(dashboard.locator('img[alt="tile image"]')).toBeVisible({ timeout: 10_000 });
});
