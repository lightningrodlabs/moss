import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { ActionHashB64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../groups/elements/group-context.js';
import '../elements/topbar-button.js';
import './create-group-dialog.js';

import { mossStoreContext } from '../context.js';
import { MossStore } from '../moss-store.js';
import { weStyles } from '../shared-styles.js';
import { AppletId } from '@lightningrodlabs/we-applet';

// Sidebar for the applet instances of a group
@localized()
@customElement('personal-view-sidebar')
export class PersonalViewSidebar extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @property()
  selectedToolHash?: ActionHashB64;

  _appletClasses = new StoreSubscriber(
    this,
    () => this._mossStore.runningAppletClasses,
    () => [this, this._mossStore],
  );

  renderTools(tools: Record<ActionHashB64, AppletId[]>) {
    console.log('selectedToolHash: ', this.selectedToolHash);
    return html`${Object.keys(tools).map(
      (actionHash) => html`
        <!-- <sl-tooltip content=""> -->
        <topbar-button
          style="margin-left: -4px; position: relative;"
          .selected=${this.selectedToolHash && this.selectedToolHash === actionHash}
          .tooltipText=${'hello'}
          placement="bottom"
        >
          <applet-logo-raw
            .toolIdentifier=${{
              type: 'class',
              originalToolActionHash: actionHash,
            }}
            placement="bottom"
            style="margin: 4px; --size: 58px;"
            @click=${() => {
              this.dispatchEvent(
                new CustomEvent('tool-selected', {
                  detail: {
                    originalToolActionHash: actionHash,
                  },
                  bubbles: false,
                  composed: true,
                }),
              );
            }}
          >
          </applet-logo-raw>
        </topbar-button>
        <!-- </sl-tooltip> -->
      `,
    )}`;
  }

  // renderApplets(applets: ReadonlyMap<EntryHash, AppletStore>) {
  //   if (Array.from(applets.entries()).length === 0) {
  //     return html`
  //       <div
  //         class="row"
  //         style="align-items: center; font-size: 20px; padding-left: 10px; font-weight: 500;"
  //       >
  //         <span style="color: #fff; font-size: 14px; opacity: .5;">
  //           No applets installed or all applets disabled...
  //         </span>
  //       </div>
  //     `;
  //   }

  //   return html`
  //     <div class="row" style="align-items: flex-end; padding-left: 10px;">
  //       ${Array.from(applets.entries())
  //         .sort((a1, a2) => a1[1].applet.custom_name.localeCompare(a2[1].applet.custom_name))
  //         .map(
  //           ([_appletBundleHash, appletStore]) => html`
  //             <applet-topbar-button
  //               .appletStore=${appletStore}
  //               .selected=${this.selectedAppletHash &&
  //               this.selectedAppletHash.toString() === appletStore.appletHash.toString()}
  //               .indicated=${this.indicatedAppletHashes.includes(
  //                 encodeHashToBase64(appletStore.appletHash),
  //               )}
  //               .tooltipText=${appletStore.applet.custom_name}
  //               placement="bottom"
  //               @click=${() => {
  //                 this.dispatchEvent(
  //                   new CustomEvent('applet-selected', {
  //                     detail: {
  //                       groupDnaHash: this._groupStore!.groupDnaHash,
  //                       appletHash: appletStore.appletHash,
  //                     },
  //                     bubbles: true,
  //                     composed: true,
  //                   }),
  //                 );
  //                 appletStore.clearNotificationStatus();
  //               }}
  //             >
  //             </applet-topbar-button>
  //           `,
  //         )}
  //     </div>
  //   `;
  // }

  renderAppletsLoading() {
    switch (this._appletClasses.value.status) {
      case 'pending':
        return html`<sl-skeleton
            style="height: 58px; width: 58px; margin-right: 10px; --border-radius: 20%;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 58px; width: 58px; margin-right: 10px; --border-radius: 20%;"
            effect="pulse"
          ></sl-skeleton>
          <sl-skeleton
            style="height: 58px; width: 58px; margin-right: 10px; --border-radius: 20%;"
            effect="pulse"
          ></sl-skeleton> `;
      case 'error':
        console.error('ERROR: ', this._appletClasses.value.error);
        return html`<display-error
          .headline=${msg('Error displaying the tool classes')}
          tooltip
          .error=${this._appletClasses.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderTools(this._appletClasses.value.value);
      default:
        return html`Invalid async status.`;
    }
  }

  render() {
    return html`
      <div class="row" style="flex: 1; align-items: center;">${this.renderAppletsLoading()}</div>
    `;
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}
