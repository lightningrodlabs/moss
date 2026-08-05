import { test, expect, launchMoss, closeMoss } from '../fixtures/moss';
import { startFreshIfLegacyImport, waitForBoot } from '../helpers/bootToReady';
import { createGroupFromMainDashboard, enterSpaceIfPrompted } from '../helpers/groups';
import { installToolFromLibrary, openToolInGroup, waitForAppletHandshake } from '../helpers/tools';
import { FIXTURE_TOOL_TITLE } from '../fixtures/toolCuration';

/**
 * Smoke #12 — An applet's own zome calls round-trip through the host signer.
 *
 * why: the handshake (#5) proves get-iframe-config + WeaveClient wiring, but it
 * does NOT go through sign-zome-call-applet — the token handout and postMessage
 * carry it. This test drives an actual applet zome call: create a post in the
 * example applet, which signs `create_post` and then reads it back via
 * `get_all_posts`, both to the applet's OWN cell. It is the smallest assertion
 * that the host's per-applet signing scope permits an applet's legitimate calls
 * (regression guard for the trust-boundary signing change). A post-summary only
 * appears if both signed calls succeeded.
 */
const GROUP_NAME = 'Signing Roundtrip';
const POST_TITLE = `pw-post-${Date.now()}`;

test('applet own-cell zome calls (create_post + get_all_posts) round-trip via the host signer', async ({
  toolCurationServer,
  bootstrapSrv,
}) => {
  test.setTimeout(360_000);

  const moss = await launchMoss({
    profileName: `pw-signing-${Date.now()}`,
    toolCurationUrl: toolCurationServer.curationUrl,
    bootstrap: bootstrapSrv,
  });

  try {
    await waitForBoot(moss.mainWindow, 90_000);
    await startFreshIfLegacyImport(moss.mainWindow);
    await createGroupFromMainDashboard(moss.mainWindow, { name: GROUP_NAME });
    await enterSpaceIfPrompted(moss.mainWindow, 'agent-one');

    await installToolFromLibrary(moss.mainWindow, {
      toolName: FIXTURE_TOOL_TITLE,
      groupName: GROUP_NAME,
    });

    const frame = await openToolInGroup(moss.mainWindow, FIXTURE_TOOL_TITLE);
    await waitForAppletHandshake(frame, 60_000);
    await expect(frame.locator('example-applet-main')).toBeVisible({ timeout: 30_000 });

    // Before creating anything the list shows its empty placeholder — confirms
    // the initial get_all_posts (also a signed own-cell call) succeeded rather
    // than erroring.
    await expect(frame.locator('all-posts')).toBeVisible({ timeout: 30_000 });

    // Fill and submit the create-post form. Shoelace form controls live in
    // nested shadow roots; set their values directly and submit the form (the
    // same evaluate-based technique the profile helper uses), which fires the
    // onSubmit handler -> create_post zome call.
    await frame.locator('create-post').evaluate(
      async (el: any, { title, content }: { title: string; content: string }) => {
        const root: ShadowRoot = el.shadowRoot;
        const titleEl: any = root.querySelector('sl-input[name="title"]');
        const contentEl: any = root.querySelector('sl-textarea[name="content"]');
        if (!titleEl || !contentEl) throw new Error('create-post form controls not found');
        titleEl.value = title;
        contentEl.value = content;
        if (titleEl.updateComplete) await titleEl.updateComplete;
        if (contentEl.updateComplete) await contentEl.updateComplete;
        const form = root.querySelector('#create-form') as HTMLFormElement | null;
        if (!form) throw new Error('#create-form not found');
        form.requestSubmit();
      },
      { title: POST_TITLE, content: 'created by e2e signing round-trip test' },
    );

    // A post-summary renders only after create_post succeeds AND the reloaded
    // get_all_posts returns the record — both signed via sign-zome-call-applet.
    await expect(frame.locator('post-summary').first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await closeMoss(moss);
  }
});
