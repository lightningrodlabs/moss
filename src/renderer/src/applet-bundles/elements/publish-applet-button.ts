import { manualReloadStore, StoreSubscriber } from '@holochain-open-dev/stores';
import { localized, msg } from '@lit/localize';
import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { notifyError } from '@holochain-open-dev/elements';

import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';

import { weStyles } from '../../shared-styles.js';
import { disableDevMode, enableDevMode, isDevModeEnabled, openApp } from '../../electron-api.js';
import { APPSTORE_APP_ID } from '../../../../main/sharedTypes.js';

@localized()
@customElement('publish-applet-button')
export class PublishAppletButton extends LitElement {
  devModeEnabled = manualReloadStore(() => isDevModeEnabled());

  isDevModeEnabled = new StoreSubscriber(
    this,
    () => this.devModeEnabled,
    () => [],
  );

  @state()
  enabling = false;

  onButtonClicked(devModeEnabled: boolean) {
    if (devModeEnabled) this.devModeDialog.show();
    else this.enableDevModeDialog.show();
  }

  async enableDevMode() {
    if (this.enabling) return;
    this.enabling = true;

    try {
      await enableDevMode();
      await this.devModeEnabled.reload();
      setTimeout(() => {
        this.devModeDialog.show();
      }, 10);
    } catch (e) {
      notifyError(msg(`Error enabling developer mode.`));
      console.error(e);
    }

    this.devModeEnabled.reload();
    this.enabling = false;
  }

  get enableDevModeDialog(): SlDialog {
    return this.shadowRoot?.getElementById('enable-dev-mode-dialog') as SlDialog;
  }

  get devModeDialog(): SlDialog {
    return this.shadowRoot?.getElementById('dev-mode-dialog') as SlDialog;
  }

  render() {
    switch (this.isDevModeEnabled.value.status) {
      case 'pending':
        return html`<sl-skeleton effect="pulse"></sl-skeleton>`;
      case 'error':
        return html`<display-error
          tooltip
          .headline=${msg('Error getting the dev mode')}
          .error=${this.isDevModeEnabled.value.error}
        ></display-error>`;
      case 'complete':
        const enabled = this.isDevModeEnabled.value.value;
        return html`
          ${!enabled
            ? html`
                <sl-dialog
                  id="enable-dev-mode-dialog"
                  .label=${msg('Enable Developer Mode')}
                  @sl-request-close=${(e) => {
                    if (this.enabling) e.preventDefault();
                  }}
                >
                  <span
                    >${msg(
                      'If you want to publish apps, first you must enable the developer mode.',
                    )}</span
                  ><br /><br />
                  <span
                    >${msg(
                      `Turning on Dev Mode installs the DevHub app. DevHub is the place where app developers
        can upload and manage their apps, and is required to publish apps to the AppStore.`,
                    )}</span
                  ><br /><br /><span
                    >${msg(`
        Installing DevHub will download a lot of data, and synchronization with other DevHub nodes may take a long time.
        Are you sure you want to continue?`)}</span
                  >
                  <sl-button slot="footer" @click=${() => this.enableDevModeDialog.hide()}
                    >${msg('Cancel')}</sl-button
                  >
                  <sl-button
                    slot="footer"
                    variant="primary"
                    @click=${async () => this.enableDevMode()}
                    .loading=${this.enabling}
                    >${msg('Enable Developer Mode')}</sl-button
                  >
                </sl-dialog>
              `
            : html`
                <sl-dialog id="dev-mode-dialog" .label=${msg('Developer Mode')}>
                  <span>${msg('Follow this instructions to publish an app:')}</span>
                  <a
                    href="https://github.com/holochain/launcher/tree/main#publishing-and-updating-an-app-in-the-app-store"
                    >${msg('How to publish an app')}</a
                  >

                  <sl-button
                    variant="warning"
                    slot="footer"
                    @click=${async () => {
                      await disableDevMode();
                      await this.devModeEnabled.reload();
                    }}
                    >${msg('Disable Dev Mode')}</sl-button
                  >
                  <sl-button slot="footer" @click=${() => openApp(APPSTORE_APP_ID)}
                    >${msg('Open AppStore')}</sl-button
                  >
                </sl-dialog>
              `}
          <sl-button @click=${() => this.onButtonClicked(enabled)}
            >${msg('Publish an applet')}</sl-button
          >
        `;
    }
  }

  static styles = weStyles;
}
