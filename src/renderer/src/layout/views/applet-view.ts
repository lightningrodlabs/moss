import { hashProperty } from '@holochain-open-dev/elements';
import { EntryHash } from '@holochain/client';
import { localized } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import { AppletView, RenderView } from '@theweave/api';

import { weStyles } from '../../shared-styles.js';
import './view-frame.js';
@localized()
@customElement('applet-view')
export class AppletViewEl extends LitElement {
  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  view!: AppletView;

  @property()
  hostColor: string | undefined;

  firstUpdated() {
    this.shadowRoot!.host.classList.add();
  }

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

  render() {
    const renderView: RenderView = {
      type: 'applet-view',
      view: this.view,
    };
    return html`
      ${this.hostStyle()}
      <view-frame
        .renderView=${renderView}
        .appletHash=${this.appletHash}
        class="elevated"
        style="flex: 1; overflow: hidden;"
      ></view-frame>
    `;
  }

  static styles = [
    css`
      :host {
        display: flex;
        padding: 8px;
        border-radius: 5px 0 0 0;
      }

      .elevated {
        border-radius: 5px;
        filter: drop-shadow(0px 4px 10px rgba(0, 0, 0, 0.5));
      }
    `,
    weStyles,
  ];
}
