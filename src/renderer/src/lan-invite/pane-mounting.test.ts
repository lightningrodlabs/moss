import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: the two local-network panes must be mounted only while their dialog is
 * open.
 *
 * Both panes own a `LanInviteSession` for as long as they are connected —
 * connecting binds the shared UDP socket (and so raises the macOS local-network
 * and Windows firewall prompts), and a running beacon keeps announcing until the
 * pane goes away. `moss-dialog.hide()` only flips `open` on the inner
 * `sl-dialog`; slotted content stays in the DOM and stays connected. So a pane
 * rendered unconditionally is a pane that is live for the whole life of the app.
 *
 * `yarn test:unit` runs in a plain node environment with no DOM, so this cannot
 * mount the elements and observe it. It asserts the next best thing: that the
 * pane tag sits inside a template conditional that tests the dialog's own
 * open-state flag. A structural check, not a behavioural one — it catches the
 * regression of dropping the guard, which is exactly how this was shipped.
 */

const RENDERER_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The template text between the nearest enclosing `${` and the pane's tag —
 * i.e. whatever expression decides that the tag gets rendered.
 */
function mountGuardFor(file: string, tag: string): string {
  const source = fs.readFileSync(path.join(RENDERER_SRC, file), 'utf8');
  const tagAt = source.indexOf(tag);
  expect(tagAt, `${tag} not found in ${file} — this scan has gone stale`).toBeGreaterThan(-1);
  const openerAt = source.lastIndexOf('${', tagAt);
  expect(openerAt, `no template expression precedes ${tag} in ${file}`).toBeGreaterThan(-1);
  return source.slice(openerAt, tagAt);
}

describe('local-network panes are mounted only while their dialog is open', () => {
  it('renders <local-network-invite> behind the invite dialog’s open flag', () => {
    const guard = mountGuardFor(
      'groups/elements/invite/invite-people-dialog.ts',
      '<local-network-invite',
    );
    expect(guard).toContain('_paneOpen');
    expect(guard).toContain('?');
  });

  it('renders <local-network-join> behind the join dialog’s open flag', () => {
    const guard = mountGuardFor('app/dialogs/join-group-dialog.ts', '<local-network-join');
    expect(guard).toContain('_dialogOpen');
    expect(guard).toContain('?');
  });

  it('clears each dialog’s open flag when the dialog itself finishes hiding', () => {
    for (const [file, flag] of [
      ['groups/elements/invite/invite-people-dialog.ts', '_paneOpen'],
      ['app/dialogs/join-group-dialog.ts', '_dialogOpen'],
    ] as const) {
      const source = fs.readFileSync(path.join(RENDERER_SRC, file), 'utf8');
      expect(source, `${file} never handles sl-after-hide`).toMatch(
        new RegExp(`sl-after-hide[\\s\\S]{0,400}${flag} = false`),
      );
    }
  });
});
