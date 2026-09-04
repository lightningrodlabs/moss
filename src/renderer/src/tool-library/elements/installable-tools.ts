import { html, LitElement, css } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { consume } from '@lit/context';
import { customElement, property, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { DnaHashB64 } from '@holochain/client';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '../../groups/elements/invite/select-group.js';

import '../../groups/elements/group-context.js';

import { mossStyles } from '../../shared-styles.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { ToolAndCurationInfo, UnifiedToolEntry } from '../../types.js';
import { getPrimaryVersionBranch, extractMajorVersion, markdownParseSafe } from '../../utils.js';
import { experimentalToolIcon } from '../../ui/icons.js';
import { mdiHarddisk } from '@mdi/js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import './library-tool-details.js';
import { LibraryToolDetails } from './library-tool-details.js';
import { libraryStyles } from '../libraryStyles.js';
import { DeveloperCollective } from '@theweave/moss-types';
import { MossDialog } from '../../ui/moss-dialog.js';
import '../../ui/moss-dialog.js';

@localized()
@customElement('installable-tools')
export class InstallableTools extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @property()
  installableTools: ToolAndCurationInfo[] = []; // Keep for backward compatibility but prefer unifiedTools

  @property()
  unifiedTools: UnifiedToolEntry[] = [];

  @property()
  devCollectives: Record<string, DeveloperCollective> = {};

  @property()
  sortMode: 'releaseDesc' | 'releaseAsc' | 'alphaAsc' | 'alphaDesc' = 'releaseDesc';

  /** Whether the curation lists answered when this list was built. */
  @property()
  libraryReachable = true;

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @query('#library-tool-details-dialog')
  toolDetailsDialog: MossDialog | undefined;

  @query('#tool-details')
  toolDetails: LibraryToolDetails | undefined;

  async firstUpdated() {}

  @state()
  selectedTool: UnifiedToolEntry | undefined;

  /**
   * The developer collective is only known when the Tool came from a curation
   * list that was actually fetched, so a Tool offered from local assets has no
   * link to show.
   */
  renderDeveloperLine(tool: UnifiedToolEntry) {
    const collective = this.devCollectives[tool.toolListUrl];
    if (!collective) return '';
    return html`
      <sl-tooltip content=${msg("Visit developer's website")}>
        <div class="tool-developer">
          <span style="opacity:.4">${msg('by')}</span>
          <a href="${collective.contact.website}">${collective.name}</a>
        </div>
      </sl-tooltip>
    `;
  }

  /**
   * Where this copy of the Tool would come from. Rendered in normal flow, well
   * clear of the absolutely positioned classification marker in the card's
   * top-right corner. Saying nothing is the right
   * answer for the ordinary case of a curated Tool that is not here yet; the
   * rest are worth a word, either because installing needs no download or
   * because no curation list vouches for the Tool at all.
   */
  renderSourceBadge(tool: UnifiedToolEntry) {
    // The card offers one branch, so the badge must describe that branch: a
    // Tool whose v1 is here but whose v2 is on offer still needs a download.
    const branch = getPrimaryVersionBranch(tool);
    if (!branch) return '';
    if (branch.onlyOnThisComputer) {
      const why = this.libraryReachable
        ? msg('Offered because it is installed on this computer. No curation list offers it.')
        : msg(
            'Offered because it is installed on this computer. The tool library is unavailable, so it cannot be checked against a curation list.',
          );
      return html`
        <sl-tooltip content=${why}>
          <div class="local-badge">
            <sl-icon .src=${wrapPathInSvg(mdiHarddisk)}></sl-icon>
            <span>${msg('Only on this computer')}</span>
          </div>
        </sl-tooltip>
      `;
    }
    if (branch.installedOnThisComputer) {
      return html`
        <sl-tooltip content=${msg('Already on this computer, so installing it needs no download.')}>
          <div class="local-badge">
            <sl-icon .src=${wrapPathInSvg(mdiHarddisk)}></sl-icon>
            <span>${msg('On this computer')}</span>
          </div>
        </sl-tooltip>
      `;
    }
    return '';
  }

  renderInstallableTool(tool: UnifiedToolEntry) {
    const primaryBranch = getPrimaryVersionBranch(tool);
    if (!primaryBranch) return html``;

    const versionBranches = Array.from(tool.versionBranches.keys())
      .map((vb) => extractMajorVersion(vb))
      .filter((v, i, arr) => arr.indexOf(v) === i) // unique
      .sort((a, b) => b - a); // descending

    const versionBadge =
      versionBranches.length > 1
        ? html`<span style="font-size: 12px; opacity: 0.6; margin-left: 5px;"
            >v${versionBranches.join(', v')}</span
          >`
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
            <sl-tooltip content="${visibility === 'low' ? 'experimental tool' : 'stable tool'}">
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
            <div class="tool-description">${unsafeHTML(markdownParseSafe(tool.description))}</div>
            ${tool.tags.length > 0
              ? html`
                  <div class="row tool-tag-list" style="margin-top:6px">
                    ${tool.tags.map((tag) => html`<div class="tool-tag">${tag}</div>`)}
                  </div>
                `
              : ''}
            ${this.renderDeveloperLine(tool)} ${this.renderSourceBadge(tool)}
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
                  groupDnaHash: e.detail,
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
    const toolsToRender =
      this.unifiedTools.length > 0
        ? this.unifiedTools
        : this.installableTools.map((tool) => {
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
              versionBranches: new Map([
                [
                  tool.toolInfoAndVersions.versionBranch,
                  {
                    versionBranch: tool.toolInfoAndVersions.versionBranch,
                    toolCompatibilityId: tool.toolCompatibilityId,
                    toolInfoAndVersions: tool.toolInfoAndVersions,
                    latestVersion: tool.latestVersion,
                    allVersions: tool.toolInfoAndVersions.versions,
                    curationInfos: tool.curationInfos,
                  },
                ],
              ]),
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
        // A Tool offered from local assets has an install date standing in for
        // a release date. Ordering the two together would be comparing
        // different things, so those sort last whenever the order is by release.
        if (
          (this.sortMode === 'releaseDesc' || this.sortMode === 'releaseAsc') &&
          !!primaryA.onlyOnThisComputer !== !!primaryB.onlyOnThisComputer
        ) {
          return primaryA.onlyOnThisComputer ? 1 : -1;
        }
        switch (this.sortMode) {
          case 'releaseAsc':
            return primaryA.latestVersion.releasedAt - primaryB.latestVersion.releasedAt;
          case 'alphaAsc':
            return tool_a.title.localeCompare(tool_b.title);
          case 'alphaDesc':
            return tool_b.title.localeCompare(tool_a.title);
          case 'releaseDesc':
          default:
            return primaryB.latestVersion.releasedAt - primaryA.latestVersion.releasedAt;
        }
      });
    return html`
      <moss-dialog id="library-tool-details-dialog" class="library-tool-details-dialog">
        <div slot="header">
          ${this.selectedTool
            ? html`
                ${this.selectedTool.title} ${this.renderSourceBadge(this.selectedTool)}
                ${this.renderDeveloperLine(this.selectedTool)}
                ${this.selectedTool.curationInfos[0]
                  ? html`<div class="tool-developer" style="color:grey">
                      (curator:<a
                        href=${this.selectedTool.curationInfos[0].curator.contact.website}
                      >
                        ${this.selectedTool.curationInfos[0].curator.name}</a
                      >)
                    </div>`
                  : ''}
              `
            : msg('Unknown Tool')}
        </div>

        <library-tool-details
          slot="content"
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
                <span class="placeholder">
                  ${this.libraryReachable
                    ? msg('No Tools available yet...')
                    : msg(
                        'The tool library is unavailable, and no Tools are installed on this computer yet.',
                      )}
                </span>
              </div>
            `
          : nonDeprecatedTools.map((tool) => this.renderInstallableTool(tool))}
      </div>
    `;
  }
  static styles = [
    libraryStyles,
    css`
      .local-badge {
        /* Inline so the badge is only as wide as its text: it sits beside a
           title in the details dialog and beside the icon on a card, and a
           block-level box would stretch across both. */
        display: inline-flex;
        align-items: center;
        width: fit-content;
        vertical-align: middle;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        background: var(--sl-color-neutral-200, #e4e4e7);
        color: var(--sl-color-neutral-700, #3f3f46);
        white-space: nowrap;
      }
      .local-badge sl-icon {
        font-size: 13px;
      }
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
