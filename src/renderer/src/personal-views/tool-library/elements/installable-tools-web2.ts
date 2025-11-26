import { html, LitElement, css } from 'lit';
import { consume } from '@lit/context';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { DnaHashB64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '../../../elements/_new_design/select-group.js';

import './install-tool-dialog.js';
import '../../../groups/elements/group-context.js';

import { mossStyles } from '../../../shared-styles.js';
import { MossStore } from '../../../moss-store.js';
import { mossStoreContext } from '../../../context.js';
import TimeAgo from 'javascript-time-ago';
import './tool-publisher.js';
import { ToolAndCurationInfo } from '../../../types.js';
import { experimentalToolIcon } from '../../../elements/_new_design/icons.js';
import './library-tool-details.js';
import { LibraryToolDetails } from './library-tool-details.js';
import { libraryStyles } from '../libraryStyles.js';
import { DeveloperCollective } from '@theweave/moss-types';
import { MossDialog } from '../../../elements/_new_design/moss-dialog.js';
import '../../../elements/_new_design/moss-dialog.js';

@localized()
@customElement('installable-tools-web2')
export class InstallableToolsWeb2 extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @property()
  installableTools: ToolAndCurationInfo[] = [];

  @property()
  devCollectives: Record<string, DeveloperCollective> = {};

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @query('#library-tool-details-dialog')
  toolDetailsDialog: MossDialog | undefined;

  @query('#tool-details')
  toolDetails: LibraryToolDetails | undefined;

  async firstUpdated() { }

  timeAgo = new TimeAgo('en-US');

  @state()
  selectedTool: ToolAndCurationInfo | undefined;

  renderInstallableTool(tool: ToolAndCurationInfo) {
    return html`
      <div
        id="tool"
        class="tool"
        tabindex="0"
        @click=${() => {
        this.selectedTool = tool;
        this.toolDetailsDialog?.show();
      }}
      >
        <div class="column">
          <div class="row">
            ${tool.toolInfoAndVersions.icon
        ? html`<img
                  src=${tool.toolInfoAndVersions.icon}
                  alt="${tool.toolInfoAndVersions.title} tool icon"
                  style="height: 64px; width: 64px; border-radius: 16px; margin-right: 15px;"
                />`
        : html``}
            <sl-tooltip
              content="${tool.curationInfos[0].info.visiblity === 'low'
        ? 'experimental tool'
        : 'stable tool'}"
            >
              <div class="row items-center tool-classification">
                ${tool.curationInfos[0].info.visiblity === 'low'
        ? html`<div class="tool-classification-image tool-experimental">
                      ${experimentalToolIcon(24)}
                    </div>`
        : ''}
              </div>
            </sl-tooltip>
          </div>
          <div id="xxx" class="column tool-info-area">
            <div class="tool-title" title="${tool.toolInfoAndVersions.subtitle}">
              ${tool.toolInfoAndVersions.title} ${tool.toolInfoAndVersions.versions[0].version}
            </div>
            <div class="tool-description">${tool.toolInfoAndVersions.description}</div>
            ${tool.toolInfoAndVersions.tags.length > 0
        ? html`
                  <div class="row tool-tag-list" style="margin-top:6px">
                    ${tool.toolInfoAndVersions.tags.map(
          (tag) => html`<div class="tool-tag">${tag}</div>`,
        )}
                  </div>
                `
        : ''}
            <sl-tooltip content="visit developer’s website">
              <div class="tool-developer">
                <span  style="opacity:.4">by</span>
                <a href="${this.devCollectives[tool.toolListUrl].contact.website}"
                  >${this.devCollectives[tool.toolListUrl].name}</a
                >
              </div>
            </sl-tooltip>
          </div>
        </div>
        <select-group
          class="show-on-hover"
          @group-selected=${async (e: CustomEvent) => {
        this.dispatchEvent(
          new CustomEvent('install-tool-to-group', {
            detail: { tool, groupDnaHash: e.detail },
            composed: true,
          }),
        );
      }}
          class=""
          style="margin:auto; width: 263px; height: 32px; margin-top: 20px; margin-bottom: 20px; position:absolute; bottom:30px;left: -22px; right: 0px;"
          id="select-group"
        ></select-group>
      </div>
    `;
  }

  render() {
    const nonDeprecatedTools = this.installableTools
      .filter((toolAndCollective) => !toolAndCollective.toolInfoAndVersions.deprecation)
      .sort((tool_a, tool_b) => tool_b.latestVersion.releasedAt - tool_a.latestVersion.releasedAt)
      .sort((tool_a, tool_b) => {
        if (
          tool_a.curationInfos[0].info.visiblity === 'low' &&
          tool_b.curationInfos[0].info.visiblity !== 'low'
        )
          return 1;
        if (
          tool_b.curationInfos[0].info.visiblity === 'low' &&
          tool_a.curationInfos[0].info.visiblity !== 'low'
        )
          return -1;
        return 0;
      });
    return html`
      <moss-dialog
        id="library-tool-details-dialog"
        class="library-tool-details-dialog"
      >
      <div slot="header">
        ${this.selectedTool ? html`
        ${this.selectedTool.toolInfoAndVersions.title}

          <sl-tooltip content="visit developer’s website">
        <div class="tool-developer">
          <span style="opacity:.4">by</span>
            <a href="${this.devCollectives[this.selectedTool.toolListUrl].contact.website}"
              >${this.devCollectives[this.selectedTool.toolListUrl].name}</a
            >
        </div>          </sl-tooltip>
      `: 'Unknown Tool'}
      </div>
      
          <library-tool-details slot="content"
            id="tool-details"
            .devCollectives=${this.devCollectives}
            .tool=${this.selectedTool}
            @install-tool-to-group=${() => {
        this.toolDetailsDialog?.hide();
      }}
          ></library-tool-details>
      </moss-dialog>
      <div
        style="display: flex; flex-direction: row; flex-wrap: wrap; align-content: flex-start; flex: 1;justify-content: center;"
      >
        ${nonDeprecatedTools.length === 0
        ? html`
              <div class="column center-content" style="flex: 1; margin-top: 50px;">
                <span class="placeholder">${msg('No Tools available yet...')}</span>
              </div>
            `
        : nonDeprecatedTools.map((tool) => this.renderInstallableTool(tool))}
      </div>
    `;
  }
  static styles = [
    libraryStyles,
    css`
      .tool {
        width: 303px;
        height: 360px;
        margin-right: 20px;
        margin-top: 20px;
        color: black;
        border-radius: 20px;
        padding: 20px;
        border: none;
        background-color: rgba(255, 255, 255, 0.7);
        position: relative;
        cursor: pointer;
      }

      .tool:hover {
        background-color: #ffffff;
      }
      .tool-info-area {
        margin-top: 19px;
        overflow: auto;
        scrollbar-width: thin;
        max-height: 230px;
      }
      .tool-title {
        font-family: 'Inter Variable';
        font-size: 16px;
        font-style: normal;
        font-weight: 600;
        line-height: 24px;
      }

      .show-on-hover {
        visibility: hidden !important;
      }
      .show-on-hover:hover {
        visibility: visible !important;
      }

      #tool:hover .show-on-hover {
        transition: all 0.25s ease !important;
        visibility: visible !important;
      }

      .tool-classification {
        border-radius: 4px;

        width: 24px;
        height: 24px;
        position: absolute;
        right: 20px;
        padding: 4px 4px;
      }
      .tool-experimental {
        color: var(--moss-purple);
        //        background: rgba(116, 97, 235, 0.3);
      }
      .tool-classification-image {
        margin-top: 10px;
        margin-left: 3px;
      }
    `,
    mossStyles,
  ];
}
