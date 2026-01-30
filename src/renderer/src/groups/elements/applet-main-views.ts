import { localized } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { encodeHashToBase64 } from '@holochain/client';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { AppletHash, AppletId } from '@theweave/api';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { mossStyles } from '../../shared-styles.js';
import { repeat } from 'lit/directives/repeat.js';
import { getAllIframes } from '../../utils.js';

import '../../layout/views/applet-main.js';

/**
 * Displays all main views of applets installed in the given group.
 */
@localized()
@customElement('applet-main-views')
export class AppletMainViews extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  private _groupStore!: GroupStore;

  _runningGroupApplets = new StoreSubscriber(
    this,
    () => this._groupStore.allMyRunningApplets,
    () => [this._groupStore],
  );

  _dashboardState = new StoreSubscriber(
    this,
    () => this._mossStore.dashboardState(),
    () => [this._mossStore],
  );

  _reloadingApplets: Array<AppletId> = [];

  displayApplet(appletHash: AppletHash) {
    return (
      this._dashboardState.value.viewType === 'group' &&
      this._dashboardState.value.appletHash &&
      encodeHashToBase64(this._dashboardState.value.appletHash) === encodeHashToBase64(appletHash)
    );
  }

  render() {
    switch (this._runningGroupApplets.value.status) {
      case 'pending':
        return html`Loading running applets...`;
      case 'error':
        return html`Failed to get running applets: ${this._runningGroupApplets.value.error}`;
      case 'complete':
        return repeat(
          this._runningGroupApplets.value.value,
          (appletHash) => encodeHashToBase64(appletHash),
          (appletHash) => {
            return html`
              <applet-main
                .appletHash=${appletHash}
                .reloading=${this._reloadingApplets.includes(encodeHashToBase64(appletHash))}
                style="flex: 1; ${this.displayApplet(appletHash) ? '' : 'display: none'}"
                @hard-refresh=${async () => {
                  // emit onBeforeUnload event and wait for callback to be executed
                  const appletId = encodeHashToBase64(appletHash);

                  const allIframes = getAllIframes();
                  const appletIframe = allIframes.find((iframe) => iframe.id === appletId);
                  if (appletIframe) {
                    appletIframe.src += '';
                  }
                  const reloadingApplets = [...this._reloadingApplets];

                  // Remove AppletId from reloading applets
                  this._reloadingApplets = reloadingApplets.filter((id) => id !== appletId);
                }}
              ></applet-main>
            `;
          },
        );
    }
  }

  static styles = [mossStyles, css``];
}
