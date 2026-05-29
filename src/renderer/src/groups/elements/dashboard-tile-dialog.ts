import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { notifyError } from '@holochain-open-dev/elements';
import { DashboardTile } from '@theweave/group-client';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import { NewTileDraft } from './dashboard-tile-utils.js';
import { closeIcon } from '../../ui/icons.js';

/**
 * The add/edit-tile form for the group dashboard. Renders to light DOM so it
 * shares group-dashboard's injected `.add-tile-*` / `moss-*` styles and so
 * shoelace inputs resolve global custom elements without extra scoping — it is
 * only ever rendered inside `<group-dashboard>` and is not a standalone widget.
 *
 * The parent opens it by setting {@link draft} (and {@link editingId} for an
 * edit) and listens for:
 * - `tile-confirmed` — detail `{ tile, editingId }` once validation passes
 * - `dialog-closed` — the user dismissed the dialog without confirming
 */
@localized()
@customElement('dashboard-tile-dialog')
export class DashboardTileDialog extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  /**
   * Initial draft to seed the form. `null` means the dialog is closed; setting
   * a draft opens it. The internal working copy ({@link _draft}) is derived
   * from this so edits never mutate the parent's object.
   */
  @property({ attribute: false }) draft: NewTileDraft | null = null;

  /**
   * When set, the dialog is in "edit" mode and confirming replaces the tile
   * with this id instead of appending a new tile.
   */
  @property({ attribute: false }) editingId: string | undefined = undefined;

  @state() private _draft: NewTileDraft | null = null;

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('draft')) {
      this._draft = this.draft ? { ...this.draft } : null;
    }
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('dialog-closed', { bubbles: true, composed: true }));
  }

  /**
   * Probe a URL via the main process (no CORS in renderer) and verify the
   * content-type matches what we'll embed: `image/*` for image tiles,
   * `text/html` (and no blocking frame headers) for iframe tiles. Notifies the
   * user on failure and returns the result.
   */
  private async _validateMediaUrl(
    url: string,
    kind: 'image' | 'iframe',
  ): Promise<{ ok: true } | { ok: false }> {
    try {
      const res = await window.electronAPI.validateMediaUrl(url, kind);
      if (res.ok) return { ok: true };
      const reasonMsg = (() => {
        switch (res.reason) {
          case 'invalid-url':
            return msg('That URL is not valid.');
          case 'unsupported-scheme':
            return msg('Only http:// and https:// URLs are allowed.');
          case 'not-an-image':
            return msg('That URL does not point to an image.');
          case 'not-html':
            return msg('That URL does not point to an embeddable web page.');
          case 'x-frame-options':
          case 'frame-ancestors':
            return msg('That site refuses to be embedded in an iframe.');
          default:
            return msg('Could not reach that URL.');
        }
      })();
      notifyError(reasonMsg);
      return { ok: false };
    } catch (e) {
      console.error('validateMediaUrl failed:', e);
      notifyError(msg('Could not reach that URL.'));
      return { ok: false };
    }
  }

  private async _confirm() {
    const draft = this._draft;
    if (!draft) return;
    try {
      let tile: DashboardTile;
      switch (draft.kind) {
        case 'markdown':
          tile = { kind: 'markdown', source: draft.source };
          break;
        case 'image': {
          const src = draft.src.trim();
          if (!src) {
            notifyError(msg('An image URL is required.'));
            return;
          }
          const v = await this._validateMediaUrl(src, 'image');
          if (!v.ok) return; // _validateMediaUrl already notified
          tile = { kind: 'image', src, alt: draft.alt || undefined };
          break;
        }
        case 'iframe': {
          const src = draft.src.trim();
          if (!src) {
            notifyError(msg('A URL is required.'));
            return;
          }
          const v = await this._validateMediaUrl(src, 'iframe');
          if (!v.ok) return;
          tile = { kind: 'iframe', src };
          break;
        }
      }
      this.dispatchEvent(
        new CustomEvent('tile-confirmed', {
          detail: { tile, editingId: this.editingId },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (e) {
      console.error('Failed to add tile:', e);
      notifyError(msg('Failed to add tile.'));
      this._close();
    }
  }

  render() {
    const draft = this._draft;
    if (!draft) return nothing;
    const isEdit = this.editingId !== undefined;
    const headerLabel = isEdit
      ? draft.kind === 'markdown'
        ? msg('Edit Markdown Tile')
        : draft.kind === 'image'
          ? msg('Edit Image Tile')
          : msg('Edit Web Tile')
      : draft.kind === 'markdown'
        ? msg('Add Markdown Tile')
        : draft.kind === 'image'
          ? msg('Add Image Tile')
          : msg('Add Web Tile');
    const confirmLabel = isEdit ? msg('Save') : msg('Add');
    // why: a plain DOM overlay instead of sl-dialog/moss-dialog. The previous
    // moss-dialog (sl-dialog underneath) version froze the page on the second
    // open in the same edit session — its modal-`inert` + backdrop animation
    // state machine races with the grid teardown that runs after each add and
    // leaves the page in a non-interactive state. A plain overlay has no such
    // hidden state.
    return html`
      <div
        class="add-tile-overlay"
        @click=${(e: Event) => {
          // backdrop click closes (panel click does not — stopPropagation).
          if (e.target === e.currentTarget) this._close();
        }}
      >
        <div class="add-tile-panel" @click=${(e: Event) => e.stopPropagation()}>
          <button class="add-tile-close" title=${msg('Close')} @click=${() => this._close()}>
            ${closeIcon(20)}
          </button>
          <div class="add-tile-title">${headerLabel}</div>
          ${draft.kind === 'markdown'
            ? html`<sl-textarea
                class="moss-input"
                label=${msg('Markdown')}
                rows="10"
                .value=${draft.source}
                @sl-input=${(e: Event) => {
                  this._draft = {
                    kind: 'markdown',
                    source: (e.target as HTMLTextAreaElement).value,
                  };
                }}
              ></sl-textarea>`
            : draft.kind === 'image'
              ? html`
                  <sl-input
                    class="moss-input"
                    label=${msg('Image URL')}
                    .value=${draft.src}
                    @sl-input=${(e: Event) => {
                      this._draft = { ...draft, src: (e.target as HTMLInputElement).value };
                    }}
                  ></sl-input>
                  <sl-input
                    class="moss-input"
                    label=${msg('Alt text')}
                    .value=${draft.alt}
                    @sl-input=${(e: Event) => {
                      this._draft = { ...draft, alt: (e.target as HTMLInputElement).value };
                    }}
                  ></sl-input>
                `
              : html`<sl-input
                  class="moss-input"
                  label=${msg('Web URL (https://...)')}
                  .value=${draft.src}
                  @sl-input=${(e: Event) => {
                    this._draft = {
                      kind: 'iframe',
                      src: (e.target as HTMLInputElement).value,
                    };
                  }}
                ></sl-input>`}
          <div class="row" style="justify-content: center; margin-top: 16px;">
            <button class="moss-button" style="width: 160px;" @click=${() => this._confirm()}>
              ${confirmLabel}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
