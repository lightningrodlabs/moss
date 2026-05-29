import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { consume } from '@lit/context';
import { DnaHash, EntryHash } from '@holochain/client';
import { notify, notifyError } from '@holochain-open-dev/elements';

import { Applet } from '@theweave/group-client';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import '../../ui/moss-dialog.js';
import { MossDialog } from '../../ui/moss-dialog.js';

export type ReenableToolInput = {
  groupDnaHash: DnaHash;
  appletHash: EntryHash;
  applet: Applet;
};

/**
 * App-root–mounted dialog that re-enables a tool the local agent has installed
 * but disabled. Listens for the bubbling `open-reenable-tool` custom event with
 * `ReenableToolInput` in its detail.
 *
 * @element reenable-tool-dialog
 */
@localized()
@customElement('reenable-tool-dialog')
export class ReenableToolDialog extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @query('#dialog')
  _dialog!: MossDialog;

  @state()
  private _input: ReenableToolInput | undefined;

  @state()
  private _enabling: boolean = false;

  async show(input: ReenableToolInput) {
    this._input = input;
    this._enabling = false;
    await this._dialog.show();
  }

  async hide() {
    await this._dialog.hide();
  }

  private async _reenable() {
    if (!this._input) return;
    const { appletHash, groupDnaHash } = this._input;
    this._enabling = true;
    try {
      await this.mossStore.enableApplet(appletHash);
      this.dispatchEvent(
        new CustomEvent('applet-enabled', {
          detail: { appletEntryHash: appletHash, groupDnaHash },
          composed: true,
          bubbles: true,
        }),
      );
      notify(msg('Tool re-enabled.'));
      await this.hide();
    } catch (e) {
      notifyError(msg('Failed to re-enable tool (See console for details).'));
      console.error(e);
    }
    this._enabling = false;
  }

  render() {
    const toolName = this._input?.applet.custom_name ?? msg('this tool');
    return html`
      <moss-dialog id="dialog" width="480px" headerAlign="left">
        <span slot="header">${msg(str`Re-enable ${toolName}?`)}</span>
        <div slot="content">
          <div class="description">
            ${msg('This tool is installed but turned off. Re-enable it to use it again.')}
          </div>
          <div class="actions row">
            <button class="moss-button-secondary" @click=${() => this.hide()}>
              ${msg('Cancel')}
            </button>
            <button
              class="moss-button"
              ?disabled=${this._enabling}
              @click=${() => this._reenable()}
            >
              ${this._enabling ? msg('Re-enabling…') : msg('Re-enable')}
            </button>
          </div>
        </div>
      </moss-dialog>
    `;
  }

  static styles = [
    mossStyles,
    css`
      .description {
        font-size: 15px;
        line-height: 1.5;
        opacity: 0.8;
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

declare global {
  interface HTMLElementEventMap {
    'open-reenable-tool': CustomEvent<ReenableToolInput>;
  }
}
