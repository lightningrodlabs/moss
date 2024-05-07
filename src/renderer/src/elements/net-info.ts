import { consume } from '@lit/context';
import { css, html, LitElement, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import {
  Action,
  AgentPubKey,
  CreateLink,
  DhtOp,
  encodeHashToBase64,
  Entry,
  HoloHash,
  NetworkInfo,
  SourceChainJsonRecord,
} from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../groups/elements/group-context.js';
import '../applets/elements/applet-logo.js';
import './create-group-dialog.js';
import './groups-for-applet.js';

import { weStyles } from '../shared-styles.js';

@localized()
@customElement('net-info')
export class NetInfo extends LitElement {
  @property()
  networkInfo!: NetworkInfo;

  render() {
    return html`
      <div class="column">
        <span> Arc Size: ${this.networkInfo.arc_size}</span>
        <span> Current peer count: ${this.networkInfo.current_number_of_peers}</span>
        <span> Total network peers: ${this.networkInfo.total_network_peers}</span>
        <span> Bytes since last query: ${this.networkInfo.bytes_since_last_time_queried}</span>
        <span>
          Rounds since last query:
          ${this.networkInfo.completed_rounds_since_last_time_queried}</span
        >
        <span> Fetch-pool ops to fetch: ${this.networkInfo.fetch_pool_info.num_ops_to_fetch}</span>
        <span>
          Fetch-pool bytes to fetch: ${this.networkInfo.fetch_pool_info.op_bytes_to_fetch}</span
        >
      </div>
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
