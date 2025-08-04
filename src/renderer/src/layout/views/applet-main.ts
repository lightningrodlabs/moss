import { hashProperty } from '@holochain-open-dev/elements';
import { EntryHash } from '@holochain/client';
import { localized } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { mossStyles } from '../../shared-styles.js';
import './applet-view.js';

@localized()
@customElement('applet-main')
export class AppletMain extends LitElement {
  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  reloading = false;

  render() {
    return html`<applet-view
      .view=${{ type: 'main' }}
      .appletHash=${this.appletHash}
      .reloading=${this.reloading}
      style="flex: 1"
    ></applet-view>`;
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
      }
    `,
    mossStyles,
  ];
}
