import { StoreSubscriber } from '@holochain-open-dev/stores';
import { AppAuthenticationToken, decodeHashFromBase64, EntryHashB64 } from '@holochain/client';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { msg, localized } from '@lit/localize';
import { ProfilesLocation, RenderView } from '@theweave/api';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';

import './view-frame.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { weStyles } from '../../shared-styles.js';
import { ToolCompatibilityId } from '@theweave/moss-types';

@localized()
@customElement('cross-group-main')
export class CrossGroupMain extends LitElement {
  @property()
  toolCompatibilityId!: ToolCompatibilityId;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @property()
  hostColor: string | undefined;

  appletsForBundle = new StoreSubscriber(
    this,
    () => this.mossStore.appletsForToolId.get(this.toolCompatibilityId),
    () => [this.toolCompatibilityId],
  );

  hostStyle() {
    if (this.hostColor) {
      return html`
        <style>
          :host {
            background: ${this.hostColor};
          }
        </style>
      `;
    }
    return html``;
  }

  renderMain(applets: Record<EntryHashB64, [AppAuthenticationToken, ProfilesLocation]>) {
    const renderView: RenderView = {
      type: 'cross-group-view',
      view: {
        type: 'main',
      },
    };

    return html` ${this.hostStyle()}
      <view-frame
        .renderView=${renderView}
        .appletHash=${decodeHashFromBase64(Object.keys(applets)[0])}
        style="flex: 1"
      >
      </view-frame>`;
  }

  render() {
    switch (this.appletsForBundle.value.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'error':
        return html`<display-error
          .headline=${msg('Error initializing the client for this group')}
          .error=${this.appletsForBundle.value.error}
        ></display-error>`;
      case 'complete':
        return this.renderMain(this.appletsForBundle.value.value);
    }
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
        padding: 8px;
        border-radius: 5px 0 0 0;
      }
    `,
  ];
}
