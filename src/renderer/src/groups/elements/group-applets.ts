import {
  AsyncReadable,
  joinAsync,
  pipe,
  sliceAndJoin,
  StoreSubscriber,
} from '@holochain-open-dev/stores';
import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { ActionHash, EntryHash, encodeHashToBase64 } from '@holochain/client';
import { EntryRecord, GetonlyMap } from '@holochain-open-dev/utils';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiToyBrickPlus } from '@mdi/js';
import { appIdFromAppletHash } from '@theweave/utils';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';

import '../../elements/navigation/sidebar-button.js';
import '../../applets/elements/applet-logo.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { mossStyles } from '../../shared-styles.js';
import { CustomView } from '../../custom-views/types.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { AppletStore } from '../../applets/applet-store.js';
import { getDevUiOverride } from '../../electron-api.js';

@localized()
@customElement('group-applets')
export class GroupApplets extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  _groupApplets = new StoreSubscriber(
    this,
    () =>
      joinAsync([
        pipe(this._groupStore.customViewsStore.allCustomViews, (allCustomViews) =>
          sliceAndJoin(this._groupStore.customViewsStore.customViews as GetonlyMap<any, any>, allCustomViews),
        ),
        pipe(this._groupStore.allMyRunningApplets, (myRunningApplets) =>
          sliceAndJoin(this.mossStore.appletStores as GetonlyMap<any, any>, myRunningApplets),
        ),
      ]) as AsyncReadable<
        [ReadonlyMap<ActionHash, EntryRecord<CustomView>>, ReadonlyMap<EntryHash, AppletStore>]
      >,
    () => [this._groupStore],
  );

  @state()
  _devOverrides: Record<string, boolean> = {};

  @state()
  _devOverridesLoaded = false;

  private async loadDevOverrides(applets: ReadonlyMap<EntryHash, AppletStore>) {
    if (this._devOverridesLoaded) return;
    this._devOverridesLoaded = true;
    const overrides: Record<string, boolean> = {};
    for (const [appletHash] of applets) {
      const appId = appIdFromAppletHash(appletHash);
      try {
        const result = await getDevUiOverride(appId);
        if (result.active) {
          overrides[encodeHashToBase64(appletHash)] = true;
        }
      } catch (e) {
        console.warn(`Failed to check dev override for ${appId}:`, e);
      }
    }
    this._devOverrides = overrides;
  }

  renderInstalledApplets(
    customViews: ReadonlyMap<ActionHash, EntryRecord<CustomView>>,
    applets: ReadonlyMap<EntryHash, AppletStore>,
  ) {
    this.loadDevOverrides(applets);

    if (customViews.size === 0 && applets.size === 0)
      return html`
        <div class="column" style="flex: 1; align-items: center">
          <span
            class="placeholder"
            style="margin: 24px; max-width: 600px; text-align: center; font-size: 20px;"
            >${msg(
              "This group doesn't have any applets installed yet. Go to the applet library (the ",
            )} <sl-icon .src=${wrapPathInSvg(mdiToyBrickPlus)}></sl-icon>${msg(
              ' icon above) to install applets to this group.',
            )}
          </span>
        </div>
      `;
    return html`
      <div class="row" style="flex-wrap: wrap;">
        ${Array.from(customViews.entries())
          .filter(([_, b]) => !!b)
          .sort(([_, a], [__, b]) => a.entry.name.localeCompare(b.entry.name))
          .map(
            ([customViewHash, customView]) => html`
              <div
                class="column"
                style="margin-right: 16px; align-items: center; cursor: pointer"
                @click=${() => {
                  this.dispatchEvent(
                    new CustomEvent('custom-view-selected', {
                      detail: {
                        groupDnaHash: this._groupStore.groupDnaHash,
                        customViewHash,
                      },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
              >
                <img
                  src="${customView.entry.logo}"
                  style="height: 120px; width: 120px; border-radius: 15px; margin-bottom: 8px"
                  alt="${customView.entry.name}"
                />
                <span>${customView.entry.name}</span>
              </div>
            `,
          )}
        ${Array.from(applets.entries())
          .sort(([_, a], [__, b]) => a.applet.custom_name.localeCompare(b.applet.custom_name))
          .map(
            ([appletHash, applet]) => html`
              <div
                class="column"
                style="margin-right: 25px; align-items: center; cursor: pointer; position: relative;"
                @click=${() => {
                  this.dispatchEvent(
                    new CustomEvent('applet-selected', {
                      detail: {
                        groupDnaHash: this._groupStore.groupDnaHash,
                        appletHash,
                      },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
              >
                <applet-logo
                  .appletHash=${appletHash}
                  class="applet-icon"
                  style="--size: 120px;"
                ></applet-logo>
                ${this._devOverrides[encodeHashToBase64(appletHash)]
                  ? html`<span class="dev-badge">DEV</span>`
                  : ''}
                <span style="margin-top: 8px; font-size: 16px;">${applet.applet.custom_name}</span>
              </div>
            `,
          )}
      </div>
    `;
  }

  render() {
    switch (this._groupApplets.value?.status) {
      case 'pending':
        return html`
          <sl-skeleton
            effect="pulse"
            style="height: 120px; width: 120px; margin-right: 25px; --border-radius: 10px; --color: var(--sl-color-primary-400);"
          ></sl-skeleton>
          <sl-skeleton
            effect="pulse"
            style="height: 120px; width: 120px; margin-right: 25px; --border-radius: 10px; --color: var(--sl-color-primary-400);"
          ></sl-skeleton>
          <sl-skeleton
            effect="pulse"
            style="height: 120px; width: 120px; margin-right: 25px; --border-radius: 10px; --color: var(--sl-color-primary-400);"
          ></sl-skeleton>
        `;
      case 'error':
        return html`<display-error
          .headline=${msg('Error fetching the Tools installed in this group')}
          .error=${this._groupApplets.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderInstalledApplets(
          this._groupApplets.value.value[0],
          this._groupApplets.value.value[1],
        );
    }
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }

      .applet-icon:hover {
        box-shadow: 0 0 10px #525252;
        border-radius: 20px;
      }

      .dev-badge {
        position: absolute;
        top: 0;
        right: 0;
        background: #e65100;
        color: white;
        font-size: 10px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 4px;
        pointer-events: none;
      }
    `,
  ];
}
