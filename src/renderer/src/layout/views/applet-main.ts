import { hashProperty } from '@holochain-open-dev/elements';
import { DnaHash, EntryHash } from '@holochain/client';
import { localized } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { mossStyles } from '../../shared-styles.js';
import './applet-view.js';
import {WAL} from "@theweave/api";

@localized()
@customElement('applet-main')
export class AppletMain extends LitElement {

  @property()
  wal: WAL | undefined;

  @property(hashProperty('applet-hash'))
  appletHash!: EntryHash;

  @property(hashProperty('group-hash'))
  groupHash: DnaHash | undefined;

  @property()
  reloading = false;

  render() {
      return html`<applet-view
      .view=${{ type: 'main', wal: this.wal}}
      .appletHash=${this.appletHash}
      .groupHash=${this.groupHash}
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
