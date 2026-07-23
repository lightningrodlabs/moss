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
import './tool-publisher.js';
import { ToolAndCurationInfo, UnifiedToolEntry } from '../../../types.js';
import { getPrimaryVersionBranch, extractMajorVersion } from '../../../utils.js';
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
  installableTools: ToolAndCurationInfo[] = []; // Keep for backward compatibility, but prefer unifiedTools

  @property()
  unifiedTools: UnifiedToolEntry[] = [];

  @property()
  devCollectives: Record<string, DeveloperCollective> = {};

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @query('#library-tool-details-dialog')
  toolDetailsDialog: MossDialog | undefined;

  @query('#tool-details')
  toolDetails: LibraryToolDetails | undefined;

  async firstUpdated() { }

  @state()
  selectedTool: UnifiedToolEntry | undefined;

  renderInstallableTool(tool: UnifiedToolEntry) {
    const primaryBranch = getPrimaryVersionBranch(tool);
    if (!primaryBranch) return html``;

    const versionBranches = Array.from(tool.versionBranches.keys())
      .map((vb) => extractMajorVersion(vb))
      .filter((v, i, arr) => arr.indexOf(v) === i) // unique
      .sort((a, b) => b - a); // descending

    const versionBadge = versionBranches.length > 1
      ? html`<span style="font-size: 12px; opacity: 0.6; margin-left: 5px;">v${versionBranches.join(', v')}</span>`
      : html``;

    const primaryCuration = primaryBranch.curationInfos[0];
    const visibility = primaryCuration?.info.visiblity || 'high';

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
            ${tool.icon
        ? html`<img
                  src=${tool.icon}
                  alt="${tool.title} tool icon"
                  style="height: 64px; width: 64px; border-radius: 16px; margin-right: 15px;"
                />`
        : html``}
            <sl-tooltip
              content="${visibility === 'low'
        ? 'experimental tool'
        : 'stable tool'}"
            >
              <div class="row items-center tool-classification">
                ${visibility === 'low'
        ? html`<div class="tool-classification-image tool-experimental">
                      ${experimentalToolIcon(24)}
                    </div>`
        : ''}
              </div>
            </sl-tooltip>
          </div>
          <div id="xxx" class="column tool-info-area">
            <div class="tool-title" title="${tool.subtitle}">
              ${tool.title} v${primaryBranch.latestVersion.version}${versionBadge}
            </div>
            <div class="tool-description">${tool.description}</div>
            ${tool.tags.length > 0
        ? html`
                  <div class="row tool-tag-list" style="margin-top:6px">
                    ${tool.tags.map(
          (tag) => html`<div class="tool-tag">${tag}</div>`,
        )}
                  </div>
                `
        : ''}
            <sl-tooltip content="visit developer's website">
              <div class="tool-developer">
                <span  style="opacity:.4">${msg('by')}</span>
                <a href="${this.devCollectives[tool.toolListUrl].contact.website}"
                  >${this.devCollectives[tool.toolListUrl].name}</a>
              </div>
            </sl-tooltip>
          </div>
        </div>
        <select-group
          class="show-on-hover"
          @group-selected=${async (e: CustomEvent) => {
        this.dispatchEvent(
          new CustomEvent('install-tool-to-group', {
            detail: { 
              unifiedTool: tool,
              versionBranch: primaryBranch.versionBranch,
              groupDnaHash: e.detail 
            },
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
    // Use unifiedTools if available, otherwise fall back to installableTools for backward compatibility
    const toolsToRender = this.unifiedTools.length > 0 ? this.unifiedTools : 
      this.installableTools.map(tool => {
        // Convert ToolAndCurationInfo to UnifiedToolEntry for backward compatibility
        const unified: UnifiedToolEntry = {
          toolId: tool.toolInfoAndVersions.id,
          toolListUrl: tool.toolListUrl,
          developerCollectiveId: tool.developerCollectiveId,
          title: tool.toolInfoAndVersions.title,
          subtitle: tool.toolInfoAndVersions.subtitle,
          description: tool.toolInfoAndVersions.description,
          icon: tool.toolInfoAndVersions.icon,
          tags: tool.toolInfoAndVersions.tags,
          curationInfos: tool.curationInfos,
          versionBranches: new Map([[tool.toolInfoAndVersions.versionBranch, {
            versionBranch: tool.toolInfoAndVersions.versionBranch,
            toolCompatibilityId: tool.toolCompatibilityId,
            toolInfoAndVersions: tool.toolInfoAndVersions,
            latestVersion: tool.latestVersion,
            allVersions: tool.toolInfoAndVersions.versions,
            curationInfos: tool.curationInfos,
          }]]),
          deprecation: tool.toolInfoAndVersions.deprecation,
        };
        return unified;
      });

    const nonDeprecatedTools = toolsToRender
      .filter((tool) => {
        const primary = getPrimaryVersionBranch(tool);
        return primary && !primary.toolInfoAndVersions.deprecation;
      })
      .sort((tool_a, tool_b) => {
        const primaryA = getPrimaryVersionBranch(tool_a);
        const primaryB = getPrimaryVersionBranch(tool_b);
        if (!primaryA || !primaryB) return 0;
        return primaryB.latestVersion.releasedAt - primaryA.latestVersion.releasedAt;
      })
      .sort((tool_a, tool_b) => {
        const primaryA = getPrimaryVersionBranch(tool_a);
        const primaryB = getPrimaryVersionBranch(tool_b);
        if (!primaryA || !primaryB) return 0;
        const visibilityA = primaryA.curationInfos[0]?.info.visiblity || 'high';
        const visibilityB = primaryB.curationInfos[0]?.info.visiblity || 'high';
        if (visibilityA === 'low' && visibilityB !== 'low') return 1;
        if (visibilityB === 'low' && visibilityA !== 'low') return -1;
        return 0;
      });
    return html`
      <moss-dialog
        id="library-tool-details-dialog"
        class="library-tool-details-dialog"
      >
      <div slot="header">
        ${this.selectedTool ? html`
        ${this.selectedTool.title}

          <sl-tooltip content="visit developer's website">
        <div class="tool-developer">
          <span style="opacity:.4">${msg('by')}</span>
            <a href="${this.devCollectives[this.selectedTool.toolListUrl].contact.website}"
              >${this.devCollectives[this.selectedTool.toolListUrl].name}</a
            >
        </div>          </sl-tooltip>
      `: 'Unknown Tool'}
      </div>
      
          <library-tool-details slot="content"
            id="tool-details"
            .devCollectives=${this.devCollectives}
            .unifiedTool=${this.selectedTool}
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
