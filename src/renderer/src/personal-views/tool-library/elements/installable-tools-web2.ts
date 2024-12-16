import { html, LitElement, css } from 'lit';
import { consume } from '@lit/context';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { DnaHashB64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import './install-tool-dialog.js';
import '../../../groups/elements/group-context.js';

import { weStyles } from '../../../shared-styles.js';
import { MossStore } from '../../../moss-store.js';
import { mossStoreContext } from '../../../context.js';
import TimeAgo from 'javascript-time-ago';
import './tool-publisher.js';
import { Tool, UpdateableEntity } from '@theweave/tool-library-client';
import { ToolAndCurationInfo } from '../../../types.js';

@localized()
@customElement('installable-tools-web2')
export class InstallableToolsWeb2 extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @property()
  installableTools: ToolAndCurationInfo[] = [];

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @state()
  _selectedToolEntity: UpdateableEntity<Tool> | undefined;

  async firstUpdated() {}

  timeAgo = new TimeAgo('en-US');

  renderInstallableTool(tool: ToolAndCurationInfo) {
    return html`
      <sl-card
        tabindex="0"
        class="tool-card"
        @click=${async () => {
          this.dispatchEvent(
            new CustomEvent('open-tool-detail-web2', {
              detail: tool,
              composed: true,
            }),
          );
        }}
        @keypress=${async (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            this.dispatchEvent(
              new CustomEvent('open-tool-detail-web2', {
                detail: tool,
                composed: true,
              }),
            );
          }
        }}
      >
        <div class="row" style="flex: 1;">
          ${tool.toolInfoAndVersions.icon
            ? html`<img
                src=${tool.toolInfoAndVersions.icon}
                alt="${tool.toolInfoAndVersions.title} tool icon"
                style="height: 80px; width: 80px; border-radius: 10px; margin-right: 15px;"
              />`
            : html``}
          <div class="column">
            <div style="font-size: 18px; margin-top: 10px; font-weight: bold;">
              ${tool.toolInfoAndVersions.title}
            </div>
            <div style="margin-top: 3px;">${tool.toolInfoAndVersions.subtitle}</div>
          </div>
        </div>
      </sl-card>
    `;
  }

  render() {
    const nonDeprecatedTools = this.installableTools
      .filter((toolAndCollective) => !toolAndCollective.toolInfoAndVersions.deprecation)
      .sort((tool_a, tool_b) => tool_b.latestVersion.releasedAt - tool_a.latestVersion.releasedAt);
    return html`
      <div
        style="display: flex; flex-direction: row; flex-wrap: wrap; align-content: flex-start; flex: 1;"
      >
        ${nonDeprecatedTools.length === 0
          ? html`
              <div class="column center-content" style="flex: 1;">
                <span class="placeholder">${msg('No Tools available yet...')}</span>
              </div>
            `
          : nonDeprecatedTools.map((tool) => this.renderInstallableTool(tool))}
      </div>
    `;
  }
  static styles = [
    css`
      sl-card::part(body) {
        /* padding-top: 5px; */
      }

      .tool-card {
        width: 400px;
        margin: 10px;
        color: black;
        --border-radius: 15px;
        cursor: pointer;
        border: none;
        --border-color: transparent;
        --sl-panel-background-color: var(--sl-color-tertiary-100);
        --sl-shadow-x-small: 1px 1px 2px 0 var(--sl-color-tertiary-700);
      }

      .tool-card:hover {
        --sl-panel-background-color: var(--sl-color-tertiary-400);
      }

      .tool-card:focus {
        --sl-panel-background-color: var(--sl-color-tertiary-400);
      }
    `,
    weStyles,
  ];
}
