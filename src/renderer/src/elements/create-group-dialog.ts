import { css, html, LitElement } from 'lit';
import { state, query, customElement } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { CellType } from '@holochain/client';
import { notifyError, onSubmit } from '@holochain-open-dev/elements';

import '@holochain-open-dev/elements/dist/elements/select-avatar.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio/radio.js';

import { weStyles } from '../shared-styles.js';
import { mossStoreContext } from '../context.js';
import { MossStore } from '../moss-store.js';

/**
 * @element create-group-dialog
 */
@localized()
@customElement('create-group-dialog')
export class CreateGroupDialog extends LitElement {
  /** Dependencies */
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  async open() {
    this._dialog.show();
  }

  /** Private properties */
  @query('#dialog')
  _dialog!: SlDialog;

  @query('form')
  form!: HTMLFormElement;

  @state()
  committing = false;

  private async createGroup(fields: { icon_src: string; name: string; option: '1' | '0' }) {
    if (this.committing) return;

    this.committing = true;

    try {
      let useProgenitor;
      switch (fields.option) {
        case '0':
          useProgenitor = false;
          break;
        case '1':
          useProgenitor = true;
          break;
        default:
          throw new Error('Invalid value for permission policy');
      }
      const groupAppInfo = await this._mossStore.createGroup(
        fields.name,
        fields.icon_src,
        useProgenitor,
      );

      this.dispatchEvent(
        new CustomEvent('group-created', {
          detail: {
            groupDnaHash: groupAppInfo.cell_info['group'][0][CellType.Provisioned].cell_id[0],
          },
          bubbles: true,
          composed: true,
        }),
      );
      this._dialog.hide();
      this.form.reset();
      this.committing = false;
    } catch (e) {
      notifyError(msg('Error creating the group.'));
      console.error(e);
      this.committing = false;
    }
  }

  render() {
    return html`
      <sl-dialog
        id="dialog"
        .label=${msg('Create New Group')}
        @sl-request-close=${(e) => {
          if (this.committing) {
            e.preventDefault();
          }
        }}
      >
        <form class="column" ${onSubmit((f) => this.createGroup(f))}>
          <div class="row" style="justify-content: center">
            <select-avatar required name="icon_src"></select-avatar>

            <sl-input
              name="name"
              style="margin-left: 16px"
              .label=${msg('Group name')}
              required
            ></sl-input>
          </div>

          <sl-radio-group
            style="margin-left: 50px; margin-top: 30px;"
            label="🔑${msg(' Group Type:')}"
            value="1"
          >
            <sl-radio style="margin-top: 5px;" value="1"
              ><b>${msg('Stewarded')}</b><br /><span style="opacity: 0.8; font-size: 0.9rem;"
                >The group creator is the initial Steward. Only Stewards can edit the group profile,
                add and remove Tools and add additional Stewards.</span
              ></sl-radio
            >
            <sl-radio style="margin-top: 5px;" value="0"
              ><b>${msg('Unstewarded')}</b><br /><span style="opacity: 0.8; font-size: 0.9rem;"
                >All members have full permissions.</span
              ></sl-radio
            >
          </sl-radio-group>

          <sl-button
            style="margin-top: 24px"
            variant="primary"
            type="submit"
            .loading=${this.committing}
          >
            ${msg('Create Group')}
          </sl-button>
        </form>
      </sl-dialog>
    `;
  }

  static styles = [
    weStyles,
    css`
      sl-dialog {
        --sl-panel-background-color: var(--sl-color-primary-0);
      }
    `,
  ];
}
