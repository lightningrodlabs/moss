import { localized, msg } from '@lit/localize';
import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
// import SlSwitch from '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
// import { notifyError } from '@holochain-open-dev/elements';

import { weStyles } from '../shared-styles.js';

@localized()
@customElement('factory-reset')
export class FactoryReset extends LitElement {
  @state()
  _resetting = false;

  async factoryReset() {
    throw new Error('Factory Reset not implemented.');
    // this._resetting = true;
    // try {
    //   const logsSwitch = this.shadowRoot!.getElementById('delete-logs-switch') as SlSwitch;
    //   const deleteLogs = logsSwitch.checked;
    //   await invoke('execute_factory_reset', { deleteLogs });
    // } catch (e) {
    //   notifyError(msg('Failed to execute factory reset.'));
    //   console.error(JSON.stringify(e));
    // }
    // this._resetting = false;
  }

  render() {
    return html`
      <sl-dialog .label=${msg('Factory Reset')} open>
        <div style="font-size: 30px; text-align: center;"><b>${msg('DANGER')}</b></div>
        <span>${msg(``)}</span><br /><span
          >${msg(
            `Executing a factory reset will delete ALL data (including all applets and groups) as well as reset your password and delete your private keys.`,
          )}</span
        >
        <div class="row" style="align-items: center; margin-top: 20px;">
          <sl-switch id="delete-logs-switch"></sl-switch>
          <div>(not recommended) Delete logs</div>
        </div>
        <sl-button
          slot="footer"
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent('cancel-factory-reset', {
                composed: true,
                bubbles: true,
              }),
            )}
          >${msg('Cancel')}</sl-button
        >
        <sl-button
          slot="footer"
          variant="primary"
          @click=${async () => this.factoryReset()}
          .loading=${this._resetting}
          >${msg('Execute Reset')}</sl-button
        >
      </sl-dialog>
    `;
  }

  static styles = weStyles;
}
