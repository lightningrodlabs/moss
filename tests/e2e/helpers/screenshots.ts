import { Page, Locator } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Screenshot capture helpers for the Moss user guide.
 *
 * These are NOT tests — the specs under `tests/e2e/screenshots/` drive the
 * built Moss app through documented user flows and write PNGs straight into
 * the user-docs repo's `docs/public/screenshots/` tree, so the guide can
 * reference them as `/screenshots/<name>.png`.
 *
 * Output location is overridable with the MOSS_DOCS_SCREENSHOT_DIR env var,
 * in case the docs repo lives elsewhere.
 */

/** Where captured PNGs land. The user-docs repo's VitePress public dir. */
export const SCREENSHOT_DIR =
  process.env.MOSS_DOCS_SCREENSHOT_DIR ??
  path.resolve(
    __dirname,
    // tests/e2e/helpers -> e2e -> tests -> moss-docs-screenshots -> holochain
    // -> metacurrency -> code, where moss-user-docs lives as a sibling.
    '..', '..', '..', '..', '..', '..',
    'moss-user-docs', 'docs', 'public', 'screenshots',
  );

/**
 * Fixed renderer viewport for every capture, so all screenshots in the guide
 * share dimensions and crop consistently. 1280x800 is a comfortable laptop
 * size that keeps the sidebars + main pane all visible.
 */
export const CAPTURE_VIEWPORT = { width: 1280, height: 800 };

function ensureDir() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/**
 * Pin the window to CAPTURE_VIEWPORT. Call once after boot, before the first
 * shot. Playwright's setViewportSize resizes the Electron BrowserWindow.
 */
export async function prepareForCapture(page: Page) {
  await page.setViewportSize(CAPTURE_VIEWPORT);
  ensureDir();
}

/**
 * Capture the whole renderer window to `<name>.png`.
 *
 * `name` is the file stem — no extension, no directory. Use the same name the
 * guide page references, e.g. shot(page, 'create-group-dialog').
 */
export async function shot(page: Page, name: string) {
  ensureDir();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

/**
 * Capture a single element (cropped) rather than the full window. Good for
 * dialogs and panels where the surrounding chrome is noise.
 */
export async function shotOf(target: Locator, name: string) {
  ensureDir();
  await target.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) });
}

/** sl-dialog show/hide animation runs ~250ms; pad it so shots aren't blurred. */
export const DIALOG_SETTLE_MS = 600;

/**
 * Wait for a dialog's inner `sl-dialog[open]` to be present, let its show
 * animation (and any predecessor's hide animation) finish, then full-window
 * capture. `slDialogSelector` must target the *inner* sl-dialog — the custom
 * element hosts lay out at zero size and read as "hidden".
 */
export async function shotDialog(page: Page, name: string, slDialogSelector: string) {
  await page.locator(slDialogSelector).waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(DIALOG_SETTLE_MS);
  await shot(page, name);
}
