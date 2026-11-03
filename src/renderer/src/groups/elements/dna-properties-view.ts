import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { decodeHashFromBase64 } from '@holochain/client';

import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '../../ui/copy-hash.js';

import { mossStyles } from '../../shared-styles.js';
import { decodeRoleProperties, PropertyDisplay } from '../dna-property-values.js';

/**
 * Shows an applet's per-role DNA properties as a key/value table. Agent keys
 * render as the group's avatars (click copies the key) so a person can see who
 * was chosen without reading base64.
 */
@localized()
@customElement('dna-properties-view')
export class DnaPropertiesView extends LitElement {
  @property({ attribute: false })
  properties: Record<string, Uint8Array> = {};

  private renderValue(value: PropertyDisplay) {
    switch (value.kind) {
      case 'agent':
        return html`<agent-avatar
          .size=${28}
          .agentPubKey=${decodeHashFromBase64(value.key)}
        ></agent-avatar>`;
      case 'agentList':
        return html`<div class="row avatars">
          ${value.keys.map(
            (key) =>
              html`<agent-avatar
                .size=${28}
                .agentPubKey=${decodeHashFromBase64(key)}
              ></agent-avatar>`,
          )}
        </div>`;
      case 'hash':
        return html`<copy-hash shortened .hash=${value.hash}></copy-hash>`;
      case 'text':
        return html`<pre class="text">${value.text}</pre>`;
    }
  }

  render() {
    const roles = decodeRoleProperties(this.properties);
    if (roles.length === 0) return html`${msg('None')}`;
    return html`
      <sl-tab-group style="width: 100%;">
        ${roles.map(
          ({ role, entries }) => html`
            <sl-tab slot="nav" .panel=${role}>${role}</sl-tab>
            <sl-tab-panel .name=${role}>
              ${entries.length === 0
                ? html`${msg('None')}`
                : html`<table>
                    ${entries.map(
                      ({ key, value }) => html`
                        <tr>
                          <td class="key">${key}</td>
                          <td class="value">${this.renderValue(value)}</td>
                        </tr>
                      `,
                    )}
                  </table>`}
            </sl-tab-panel>
          `,
        )}
      </sl-tab-group>
    `;
  }

  static styles = [
    mossStyles,
    css`
      table {
        border-collapse: collapse;
        width: 100%;
        text-align: left;
      }
      td {
        padding: 6px 8px;
        vertical-align: middle;
        border-bottom: 1px solid var(--moss-grey-light);
      }
      .key {
        font-family: monospace;
        white-space: nowrap;
        width: 1%;
      }
      .text {
        margin: 0;
        font-family: monospace;
        white-space: pre-wrap;
        word-break: break-all;
      }
      .avatars {
        flex-wrap: wrap;
        gap: 4px;
      }
    `,
  ];
}
