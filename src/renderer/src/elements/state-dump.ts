import { css, html, LitElement, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import {
  Action,
  AgentPubKey,
  CreateLink,
  DhtOp,
  encodeHashToBase64,
  Entry,
  HoloHash,
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
import { dateStr } from '../utils.js';
import { DumpData } from '../types.js';
import { decode } from '@msgpack/msgpack';

const PAGE_SIZE = 10;

@localized()
@customElement('state-dump')
export class StateDump extends LitElement {
  @property()
  dump!: DumpData;

  renderCreateLink(createLink: CreateLink) {
    return html` Base: ${this.renderHash(createLink.base_address)}; Target:
    ${this.renderHash(createLink.target_address)}`;
  }

  @state()
  opsPage = 0;

  renderDhtOps() {
    const start = this.dump.dump.integration_dump.integrated.length - 1 - PAGE_SIZE * this.opsPage;
    const end = start - PAGE_SIZE;
    const opsHtml = [];
    for (let i = start; i > end && i >= 0; i -= 1) {
      const r = this.dump.dump.integration_dump.integrated[i];
      // @ts-ignore
      opsHtml.push(html` <div class="list-item">${this.renderDhtOp(r)}</div>`);
    }
    return opsHtml;
  }

  renderDhtOp(op: DhtOp) {
    const opName = Object.keys(op)[0];
    const opValue = Object.values(op)[0];
    const action: Action = opValue[1];

    let entry: Entry | undefined;
    if (opName == 'StoreEntry') {
      entry = opValue[2];
    } else if (opName == 'StoreRecord' && action.type == 'Create') {
      if (opValue[2]['Present']) {
        entry = opValue[2]['Present'];
      }
    }

    return html`
      <div class="dht-op">
        ${opName}: ${action.type}
        <span class="date">${dateStr(action.timestamp)}</span>
        ${action.author ? html`by ${this.renderHash(action.author)}` : ''}
        ${action.type == 'CreateLink' ? this.renderCreateLink(action) : ''}
        ${entry ? this.renderEntry(entry) : ''}
        ${opName == 'RegisterAddLink' ? this.renderCreateLink(action as CreateLink) : ''}
      </div>
    `;
  }

  renderHash(hash: HoloHash) {
    const hashB64 = encodeHashToBase64(hash);
    return html` <span class="hash" title="${hashB64}">${hashB64.slice(0, 8)}</span> `;
  }

  renderObjectWithHashes(object: Object) {
    return Object.entries(object).map(
      ([key, value]) =>
        html`${key}:${value && value['0'] === 132 && value['1'] == '32' && value['2'] == 36
          ? this.renderHash(value)
          : JSON.stringify(value)}; `,
    );
  }

  renderUnknownSerializedObject(object: Object) {
    try {
      // @ts-ignore
      return JSON.stringify(decode(object));
    } catch (e) {
      // @ts-ignore
      const x = Array.from(object);
      // @ts-ignore
      return String.fromCharCode.apply(null, x);
    }
  }

  renderEntry(entry: Entry) {
    const entry_type = Object.keys(entry.entry_type)[0]; // Fixme in version 0.4
    const entry_data = entry.entry;
    let entryHtml: undefined | TemplateResult;
    if (entry_type === 'App') {
      const decoded = decode(entry_data as Uint8Array) as Object;
      if (decoded['document_hash'] && decoded['name'])
        entryHtml = html`<span class="syn"
          >Syn-Workspace Doc:${this.renderHash(decoded['document_hash'])}: ${decoded['name']}</span
        >`;
      else if (decoded['initial_state'] && decoded['meta']) {
        const state = decode(decoded['initial_state']) as Object;
        const meta = decode(decoded['meta']) as Object;
        entryHtml = html`<span class="syn"
          >Syn-Document
          Meta->${this.renderObjectWithHashes(
            meta,
          )}--InitialState:${this.renderUnknownSerializedObject(state)}</span
        >`;
      } else if (decoded['document_hash'] && decoded['state']) {
        const state = decode(decoded['state']) as object;
        entryHtml = html` <div class="syn">
          Syn-Commit Doc:${this.renderHash(decoded['document_hash'])}---
          <span
            >previous commits:
            ${decoded['previous_commit_hashes'].map((h) => this.renderHash(h))}</span
          >
          <div>${this.renderUnknownSerializedObject(state)}</div>
        </div>`;
      } else {
        entryHtml = html`<span class="app-entry">${JSON.stringify(decoded)}</span>`;
      }
    }
    return html`
      <div class="entry">
        ${entry_type}--${entry_type == 'Agent' ? this.renderHash(entry_data as AgentPubKey) : ''}
        ${entryHtml ? entryHtml : ''}
        ${entry_type === 'App' && !entryHtml ? JSON.stringify(entry_data) : ''}
      </div>
    `;
  }
  renderRecord(record: SourceChainJsonRecord) {
    return html`
      <span class="record">
        <span class="action-type">${record.action.type}</span>
        ${this.renderHash(record.action_address)}
        <span class="date">${dateStr(record.action.timestamp)}</span>
        ${record.entry ? this.renderEntry(record.entry) : ''}
        ${record.action.type == 'CreateLink' ? this.renderCreateLink(record.action) : ''}
      </span>
    `;
  }

  @state()
  recordPage = 0;

  renderRecords() {
    const start = this.dump.dump.source_chain_dump.records.length - 1 - PAGE_SIZE * this.recordPage;
    const end = start - PAGE_SIZE;
    const recordsHtml = [];
    for (let i = start; i > end && i >= 0; i -= 1) {
      const r = this.dump.dump.source_chain_dump.records[i];
      // @ts-ignore
      recordsHtml.push(html` <div class="list-item">${this.renderRecord(r)}</div>`);
    }
    return recordsHtml;
  }
  render() {
    return html`
      <div class="column">
        <span>
          Peers: (${Object.keys(this.dump.dump.peer_dump.peers).length})
          <div class="long-list">
            ${Object.entries(this.dump.dump.peer_dump.peers).map(
              (p) =>
                html` <div class="list-item">
                  ${p[0]}: ${this.renderHash(p[1].kitsune_agent)}-- ${p[1].dump}
                </div>`,
            )}
          </div>
        </span>
        <span> integrated Ops since last Dump: ${this.dump.newOpsCount}</span>
        <div>
          <div style="display:flex; flex-direction:column;">
            <span>Integrated Ops: ${this.dump.dump.integration_dump.dht_ops_cursor}</span>
            <div style="display:flex;">
              Page:
              <div
                class="pager"
                @click=${() => {
                  if (this.opsPage > 0) this.opsPage -= 1;
                }}
              >
                -
              </div>
              ${this.opsPage}
              <div
                class="pager"
                @click=${() => {
                  if (this.opsPage < this.dump.dump.integration_dump.integrated.length / PAGE_SIZE)
                    this.opsPage += 1;
                }}
              >
                +
              </div>
            </div>
          </div>
          <div class="long-list">${this.renderDhtOps()}</div>
        </div>
        <span> published ops count: ${this.dump.dump.source_chain_dump.published_ops_count}</span>
        <div>
          <div style="display:flex; flex-direction:column;">
            <span>Source Chain: (${this.dump.dump.source_chain_dump.records.length} records) </span>
            <div style="display:flex;">
              Page:
              <div
                class="pager"
                @click=${() => {
                  if (this.recordPage > 0) this.recordPage -= 1;
                }}
              >
                -
              </div>
              ${this.recordPage}
              <div
                class="pager"
                @click=${() => {
                  if (this.recordPage < this.dump.dump.source_chain_dump.records.length / PAGE_SIZE)
                    this.recordPage += 1;
                }}
              >
                +
              </div>
            </div>
          </div>
          <div class="long-list">${this.renderRecords()}</div>
        </div>
      </div>
    `;
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
      }

      .long-list {
        border: solid 1px #aaa;
        max-height: 1000px;
        overflow-y: auto;
        border-radius: 5px;
      }
      .list-item {
        margin-left: 5px;
        border-bottom: solid 1px #ddd;
        padding: 2px;
        overflow-x: auto;
        line-break: anywhere;
      }
      .pager {
        margin-left: 5px;
        margin-right: 5px;
        display: flex;
        justify-content: center;
        align-items: center;
        background-color: lightgreen;
        border-radius: 50%;
        cursor: pointer;
        height: 15px;
        width: 15px;
      }
      .pager:hover {
        background-color: green;
        border-color: green;
      }
      .action-type {
        font-weight: bold;
      }
      .entry {
        margin-left: 10px;
      }
      .syn {
        padding: 4px;
        background-color: lightcoral;
      }
      .app-entry {
        padding: 4px;
        background-color: lightblue;
      }

      .hash {
        background-color: #ccc;
        font-size: 80%;
        border-radius: 5px;
        padding: 2px;
      }
    `,
  ];
}
