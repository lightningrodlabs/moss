import { pipe, sliceAndJoin, StoreSubscriber } from '@holochain-open-dev/stores';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { encodeHashToBase64, EntryHash } from '@holochain/client';
import { hashState } from '@holochain-open-dev/elements';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

import './applet-detail-card.js';
import './group-context.js';
import './group-logo.js';
import '../../applets/elements/applet-logo.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import '../../elements/navigation/sidebar-button.js';
import { weStyles } from '../../shared-styles.js';
import { Applet } from '../../types.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { repeat } from 'lit/directives/repeat.js';

@localized()
@customElement('group-applets-settings')
export class GroupAppletsSettings extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  _groupApplets = new StoreSubscriber(
    this,
    () =>
      pipe(this._groupStore.allMyInstalledApplets, (myInstalledApplets) =>
        sliceAndJoin(this._groupStore.applets, myInstalledApplets),
      ),
    () => [this._groupStore, this._mossStore],
  );

  @state(hashState())
  appletToUnarchive: EntryHash | undefined;

  @state()
  archiving = false;

  @state()
  unarchiving = false;

  renderInstalledApplets(applets: ReadonlyMap<EntryHash, Applet>) {
    const groupDisabled = !!this._mossStore.persistedStore.disabledGroupApplets.value(
      this._groupStore.groupDnaHash,
    );
    if (applets.size === 0)
      return html`
        <div class="row center-content" style="flex: 1">
          <span
            class="placeholder"
            style="margin: 24px; text-align: center; max-width: 600px; font-size: 20px;"
            >${msg(
              "You don't have any Tools installed in this group. Go to the Tool Library to install Tools to this group.",
            )}
          </span>
        </div>
      `;
    return html`
      <div class="column" style="flex: 1;">
        ${repeat(
          Array.from(applets.entries()).sort(([_, a], [__, b]) =>
            a.custom_name.localeCompare(b.custom_name),
          ),
          ([appletHash, _applet]) => encodeHashToBase64(appletHash),
          ([appletHash, applet]) => html`
            <applet-detail-card
              style="${groupDisabled ? 'opacity: 0.4; pointer-events: none;' : ''}"
              @applets-disabled=${(e) => {
                this.dispatchEvent(
                  new CustomEvent('applets-disabled', {
                    detail: e.detail,
                    bubbles: true,
                    composed: true,
                  }),
                );
              }}
              .appletHash=${appletHash}
              .applet=${applet}
            ></applet-detail-card>
          `,
        )}
      </div>
    `;
  }

  render() {
    switch (this._groupApplets.value?.status) {
      case 'pending':
        return html` <div class="column center-content" style="flex: 1;">
          <sl-spinner style="font-size: 30px;"></sl-spinner>
        </div>`;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the applets installed in this group')}
          .error=${this._groupApplets.value.error}
        ></display-error>`;
      case 'complete':
        return html`
          <div
            class="column"
            style="flex: 1; align-items: center; overflow: auto; padding: 30px 10px 20px 10px; --sl-border-radius-medium: 20px;"
          >
            <div class="row" style="position: relative">
              <div class="title" style="margin-bottom: 30px; font-size: 28px;">
                ${msg('Joined Tools')}
              </div>
            </div>
            ${this.renderInstalledApplets(this._groupApplets.value.value)}
          </div>
        `;
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
        background-color: #e1e1e1;
      }
    `,
  ];
}
