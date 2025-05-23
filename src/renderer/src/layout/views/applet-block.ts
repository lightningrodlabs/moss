import { hashProperty } from '@holochain-open-dev/elements';
import { EntryHash } from '@holochain/client';
import { localized } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { mossStyles } from '../../shared-styles.js';
import './applet-view.js';

@localized()
@customElement('applet-block')
export class AppletBlock extends LitElement {
  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property()
  block!: string;

  @property()
  context!: any;

  render() {
    return html`<applet-view
      .appletHash=${this.appletHash}
      .view=${{ type: 'block', block: this.block, context: this.context }}
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
