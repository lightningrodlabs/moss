import { css, html, LitElement, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';
import {
  Action,
  AgentPubKey,
  ChainOp,
  CreateLink,
  DhtOp,
  encodeHashToBase64,
  Entry,
  HoloHash,
  WarrantOp,
} from '@holochain/client';

import '@shoelace-style/shoelace/dist/components/button/button.js';

import { weStyles } from '../../shared-styles.js';
import { dateStr } from '../../utils.js';
import { decode } from '@msgpack/msgpack';

@localized()
@customElement('dht-op-detail')
export class DhtOpDetail extends LitElement {
  @property()
  dhtOp!: DhtOp;

  renderCreateLink(createLink: CreateLink) {
    return html` Base: ${this.renderHash(createLink.base_address)}; Target:
    ${this.renderHash(createLink.target_address)}`;
  }

  renderDhtOp(op: DhtOp) {
    const opType = Object.keys(op)[0]; // ChainOp or WarrantOp
    if (opType === 'ChainOp') {
      const opContent: ChainOp = op[opType];
      const opName = Object.keys(opContent)[0];
      const opValue = Object.values(opContent)[0];
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
    } else {
      const opContent: WarrantOp = op[opType];
      return html`
        <div class="warrant-op column">
          <span style="font-weight: bold;">WARRANT</span>
          <span class="date">${dateStr(opContent.timestamp)}</span>
        </div>
      `;
    }
  }

  renderHash(hash: HoloHash) {
    const hashB64 = encodeHashToBase64(hash);
    return html` <span class="hash" title="${hashB64}">${hashB64.slice(0, 10)}</span> `;
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

  render() {
    return this.renderDhtOp(this.dhtOp);
  }

  static styles = [
    weStyles,
    css`
      :host {
        display: flex;
      }

      .warrant-op {
        background: #b000007c;
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
