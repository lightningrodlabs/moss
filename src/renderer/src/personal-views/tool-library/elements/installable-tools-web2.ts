import { html, LitElement, css } from 'lit';
import { consume } from '@lit/context';
import { customElement, property, state } from 'lit/decorators.js';
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
import { DeveloperCollective, Tool, UpdateableEntity } from '@theweave/tool-library-client';
import { ToolAndCurationInfo } from '../../../types.js';
import {
  experimentalToolIcon,
  installToolIcon,
  stableToolIcon,
} from '../../../elements/_new_design/icons.js';

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

  @state()
  _selectedToolEntity: UpdateableEntity<Tool> | undefined;

  async firstUpdated() {}

  timeAgo = new TimeAgo('en-US');

  renderInstallableTool(tool: ToolAndCurationInfo) {
    return html`
      <div id="tool" class="tool" tabindex="0">
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
                ? 'experimental app'
                : 'stable app'}"
            >
              <div class="row items-center tool-classification">
                ${tool.curationInfos[0].info.visiblity === 'low'
                  ? html`<div class="tool-classification-image tool-experimental">
                      ${experimentalToolIcon(24)}
                    </div>`
                  : html`<div class="tool-classification-image tool-stable">
                      ${stableToolIcon(24)}
                    </div>`}
              </div>
            </sl-tooltip>
          </div>
          <div id="xxx" class="column" style="margin-top:19px; ">
            <div class="tool-title" title="${tool.toolInfoAndVersions.subtitle}">
              ${tool.toolInfoAndVersions.title}
            </div>
            <div class="tool-description">${tool.toolInfoAndVersions.description}</div>
            ${tool.toolInfoAndVersions.tags.length > 0
              ? html`
                  <div class="row" style="margin-top:6px">
                    ${tool.toolInfoAndVersions.tags.map(
                      (tag) => html`<div class="tool-tag">${tag}</div>`,
                    )}
                  </div>
                `
              : ''}
            <sl-tooltip content="visit developer’s website">
              <div class="tool-developer">
                <span>by</span>
                <a href="${this.devCollectives[tool.toolListUrl].website}"
                  >${this.devCollectives[tool.toolListUrl].name}</a
                >
              </div>
            </sl-tooltip>
          </div>
        </div>
        <select-group
          @group-selected=${async (e: CustomEvent) => {
            this.dispatchEvent(
              new CustomEvent('install-tool-to-group', {
                detail: { tool, groupDnaHash: e.detail },
                composed: true,
              }),
            );
          }}
          class=""
          style="margin:auto; width: 263px; height: 32px; margin-top: 20px; margin-bottom: 20px; position:absolute; bottom:20px;left: -22px; right: 0px;"
          id="select-group"
        ></select-group>
        <button
          class="install-button moss-button "
          style="display:none; margin:auto; width: 263px; height: 32px; margin-top: 20px; margin-bottom: 20px; position:absolute; bottom:0px;left: 0px; right: 0px;"
          @click=${async (e: MouseEvent) => {
            this.dispatchEvent(
              new CustomEvent('open-tool-detail-web2', {
                detail: { tool, origElement: e.target },
                composed: true,
              }),
            );
          }}
          @keypress=${async (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              this.dispatchEvent(
                new CustomEvent('open-tool-detail-web2', {
                  detail: { tool, origElement: e.target },
                  composed: true,
                }),
              );
            }
          }}
        >
          <div class="row center-content">
            ${installToolIcon(20)}
            <div style="margin-left: 10px;">${msg('Install to a group space')}</div>
          </div>
        </button>
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
      <div
        style="display: flex; flex-direction: row; flex-wrap: wrap; align-content: flex-start; flex: 1;"
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
      }

      .tool:hover {
        background-color: #ffffff;
      }

      .tool-title {
        font-family: 'Inter Variable';
        font-size: 16px;
        font-style: normal;
        font-weight: 600;
        line-height: 24px;
      }
      .tool-description {
        font-family: 'Inter Variable';
        font-size: 12px;
        font-style: normal;
        font-weight: 500;
        line-height: 16px; /* 133.333% */
        opacity: 0.6;
        max-height: 100px;
        overflow-x: auto;
      }
      .tool-tag {
        margin-right: 4px;
        padding: 2px;
        border-radius: 4px;
        background: rgba(137, 214, 188, 0.3);

        font-family: 'Inter Variable';
        font-size: 12px;
        font-style: normal;
        font-weight: 500;
        line-height: 16px; /* 133.333% */
      }
      .tool-developer {
        margin-top: 25px;
      }
      .tool-developer a {
        color: #324d47;
        text-decoration: none;
      }
      .tool-developer a:hover {
        text-decoration: underline;
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
        background: rgba(0, 0, 0, 0.3);

        width: 24px;
        height: 24px;
        position: absolute;
        right: 20px;
        padding: 4px 4px;
      }
      .tool-experimental {
        color: var(--moss-purple);
        background: rgba(116, 97, 235, 0.3);
      }
      .tool-classification-image {
        margin-top: 10px;
        margin-left: 3px;
      }
    `,
    mossStyles,
  ];
}
