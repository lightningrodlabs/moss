import { LitElement, css, html } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import type { AudioSourcePickerRequest, AudioSourceRow } from '@theweave/moss-types';

import { mossStyles } from '../shared-styles.js';
import '../ui/moss-dialog.js';
import type { MossDialog } from '../ui/moss-dialog.js';

/** Where the chosen row ids (or null for a cancel) go. */
export type AudioSourcePickerAnswer = (pickerId: string, ids: string[] | null) => void;

/**
 * Asks the user which sounds a Tool may hear: all system output and/or
 * individual applications. Shown in the window of the Tool that asked, so it
 * sits over that Tool. Every way the dialog closes answers exactly once.
 *
 * @element audio-source-picker-dialog
 */
@localized()
@customElement('audio-source-picker-dialog')
export class AudioSourcePickerDialog extends LitElement {
  @query('#dialog')
  _dialog!: MossDialog;

  @state()
  private _request: AudioSourcePickerRequest | undefined;

  @state()
  private _chosen = new Set<string>();

  private _answer: AudioSourcePickerAnswer | undefined;

  async show(request: AudioSourcePickerRequest, answer: AudioSourcePickerAnswer) {
    // A newer request supersedes one still on screen; main has already
    // stopped waiting for the old id, so its answer only needs to be dropped.
    this._request = request;
    this._answer = answer;
    this._chosen = new Set();
    await this.updateComplete;
    await this._dialog.show();
  }

  private _finish(ids: string[] | null) {
    const request = this._request;
    const answer = this._answer;
    this._answer = undefined;
    if (request && answer) answer(request.pickerId, ids);
    void this._dialog.hide();
  }

  private _toggle(id: string, checked: boolean) {
    const next = new Set(this._chosen);
    if (checked) next.add(id);
    else next.delete(id);
    this._chosen = next;
  }

  private _rowName(row: AudioSourceRow) {
    return row.kind === 'system' ? msg('All system audio (except Moss)') : row.name;
  }

  private _rowStatus(row: AudioSourceRow) {
    if (row.kind === 'system' || row.playing === null) return html``;
    return row.playing
      ? html`<span class="status playing">${msg('playing')}</span>`
      : html`<span class="status">${msg('silent')}</span>`;
  }

  private _renderRow(row: AudioSourceRow) {
    return html`
      <label class="source row">
        <input
          type="checkbox"
          .checked=${this._chosen.has(row.id)}
          @change=${(e: Event) => this._toggle(row.id, (e.target as HTMLInputElement).checked)}
        />
        <span class="name">${this._rowName(row)}</span>
        ${this._rowStatus(row)}
      </label>
    `;
  }

  render() {
    const rows = this._request?.rows ?? [];
    const system = rows.filter((r) => r.kind === 'system');
    const apps = rows.filter((r) => r.kind === 'app');
    const toolName = this._request?.toolName ?? '';
    return html`
      <moss-dialog
        id="dialog"
        width="480px"
        contentPadding="32px 36px"
        headerAlign="left"
        @sl-after-hide=${() => {
          // Closed with the X button, Escape, or a backdrop click.
          if (this._answer) this._finish(null);
        }}
      >
        <span slot="header">${msg(str`Share audio with ${toolName}`)}</span>
        <div slot="content" class="column">
          <div class="description">
            ${msg('Choose what this Tool can hear. Sound from Moss itself is never shared.')}
          </div>
          <div class="sources column">
            ${system.map((r) => this._renderRow(r))}
            <div class="divider"></div>
            ${apps.length === 0
              ? html`<div class="empty">
                  ${msg('No applications with audio output were found.')}
                </div>`
              : apps.map((r) => this._renderRow(r))}
          </div>
          <div class="actions row">
            <button class="moss-button-secondary" @click=${() => this._finish(null)}>
              ${msg('Cancel')}
            </button>
            <button
              class="moss-button"
              ?disabled=${this._chosen.size === 0}
              @click=${() => this._finish([...this._chosen])}
            >
              ${msg('Share')}
            </button>
          </div>
        </div>
      </moss-dialog>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        /* Mounted on the document body, so it cannot inherit a window's font. */
        font-family: 'Inter Variable', 'Aileron', 'Open Sans', 'Helvetica Neue', sans-serif;
      }
      .description {
        font-size: 15px;
        line-height: 1.5;
        opacity: 0.8;
      }
      .sources {
        margin-top: 20px;
        gap: 2px;
      }
      .source {
        align-items: center;
        gap: 12px;
        padding: 8px 10px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
      }
      .source:hover {
        background: var(--moss-light-green);
      }
      .source input {
        width: 18px;
        height: 18px;
        margin: 0;
        accent-color: var(--moss-dark-green);
        cursor: pointer;
      }
      .name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .status {
        font-size: 13px;
        opacity: 0.6;
      }
      .status.playing {
        color: var(--moss-dark-green);
        opacity: 1;
        font-weight: 500;
      }
      .divider {
        height: 1px;
        margin: 6px 0;
        background: var(--moss-grey-light);
      }
      .empty {
        padding: 8px 10px;
        font-size: 14px;
        opacity: 0.6;
      }
      .actions {
        justify-content: flex-end;
        gap: 12px;
        margin-top: 28px;
      }
      .actions button {
        padding: 10px 24px;
        font-size: 16px;
        border-radius: 10px;
        white-space: nowrap;
      }
    `,
  ];
}
