import { hashProperty } from '@holochain-open-dev/elements';
import { EntryHash } from '@holochain/client';
import { localized } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import { AppletView, RenderView } from '@lightningrodlabs/we-applet';

import { weStyles } from '../../shared-styles.js';
import './view-frame.js';
@localized()
@customElement('applet-view')
export class AppletViewEl extends LitElement {
  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  view!: AppletView;

  render() {
    const renderView: RenderView = {
      type: 'applet-view',
      view: this.view,
    };
    return html`
      <view-frame
        .renderView=${renderView}
        .appletHash=${this.appletHash}
        style="flex: 1; border-radius: 5px; overflow: hidden;
        filter: drop-shadow(0px 4px 10px rgba(0, 0, 0, 0.5));"
      ></view-frame>
    `;
  }

  static styles = [
    css`
      :host {
        display: flex;
        background-color: rgba(86, 113, 71, 1);
        padding: 8px;
        border-radius: 5px 0 0 0;
      }
    `,
    weStyles,
  ];
}
