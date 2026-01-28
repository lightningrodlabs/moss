import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import { mossStyles } from '../../shared-styles.js';
import { AppletHash } from '@theweave/api';
import { consume } from '@lit/context';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';

@customElement('groups-for-applet')
export class GroupsForApplet extends LitElement {
  @consume({ context: mossStoreContext })
  _mossStore!: MossStore;

  @property()
  appletHash!: AppletHash;

  @property()
  size?: number;

  _groupProfiles = new StoreSubscriber(
    this,
    () =>
      pipe(this._mossStore.groupsForApplet.get(this.appletHash)!, async (groupStoreMap) => {
        const groupProfiles = await Promise.all(
          Array.from(groupStoreMap.values()).map(async (groupStore) =>
            toPromise(groupStore!.groupProfile),
          ),
        );
        return groupProfiles;
      }),
    () => [this.appletHash, this._mossStore],
  );

  render() {
    switch (this._groupProfiles.value.status) {
      case 'pending':
        return html`
          <sl-skeleton
            style="height: ${this.size ? `${this.size}px` : '34px;'}; width: ${this.size
              ? `${this.size}px`
              : '34px;'};"
            effect="pulse"
          ></sl-skeleton>
        `;
      case 'complete':
        return html`
          <div class="row" style="align-items: center;">
            ${Array.from(this._groupProfiles.value.value.values()).map((groupProfile) => {
              if (groupProfile) {
                return html`
                  <img
                    src=${groupProfile.icon_src}
                    .title=${groupProfile.name}
                    style="margin-right: 3px; border-radius: 50%; height: ${this.size
                      ? `${this.size}px`
                      : '34px'}; width: ${this.size ? `${this.size}px` : '34px'};"
                  />
                `;
              } else {
                return html`
                  <div
                    class="column center-content"
                    style="margin-right: 3px; background: gray; border-radius: 50%; height: ${this
                      .size
                      ? `${this.size}px`
                      : '34px'}; width: ${this.size ? `${this.size}px` : '34px'};"
                    title="Unknown Group"
                  >
                    ?
                  </div>
                `;
              }
            })}
          </div>
        `;
      case 'error':
        console.error('Failed to get groups for applet: ', this._groupProfiles.value.error);
        return;
    }
  }

  static get styles() {
    return [
      mossStyles,
      css`
        :host {
          display: flex;
        }
      `,
    ];
  }
}
