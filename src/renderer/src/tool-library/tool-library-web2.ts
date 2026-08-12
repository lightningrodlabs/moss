import { html, LitElement, css } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { getPrimaryVersionBranch } from '../utils.js';
import {
  DeveloperCollective,
  ToolCompatibilityId,
  ToolCurationConfig,
  ToolCurationList,
  ToolCurator,
} from '@theweave/moss-types';
import { UnifiedToolEntry } from '../types.js';
import {
  DEFAULT_PRODUCTION_TOOL_CURATION_CONFIGS,
  fetchUnifiedTools,
} from './fetch-unified-tools.js';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';

import { mossStyles } from '../shared-styles.js';
import '../groups/elements/invite/select-group.js';
import { mdiEmailOutline, mdiWeb } from '@mdi/js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import './elements/curation-list-manager.js';
import './elements/installable-tools-web2.js';
import { mossStoreContext } from '../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../moss-store.js';
import { groupStoreContext } from '../groups/context.js';
import { GroupStore } from '../groups/group-store.js';
import { SelectGroup } from '../groups/elements/invite/select-group.js';
import { DnaHashB64, decodeHashFromBase64 } from '@holochain/client';
import { InstallToolDialogWeb2 } from './elements/install-tool-dialog-web2.js';
import './elements/install-tool-dialog-web2.js';
import { ToolAndCurationInfo, ToolListUrl } from '../types';
import { appStoreIcon, devIcon, experimentalToolIcon, stableToolIcon } from '../ui/icons.js';
import '../ui/moss-dialog.js';
import { MossDialog } from '../ui/moss-dialog';
import { NamedUrl, UrlListManager } from './elements/curation-list-manager';

enum ToolLibraryView {
  Main,
  //ToolDetail,
}

enum ToolDetailView {
  Description,
  //VersionHistory,
  //PublisherInfo,
}

@localized()
@customElement('tool-library-web2')
export class ToolLibraryWeb2 extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore: GroupStore | undefined; // will only be defined if the Tools library is being accessed from within a group

  @state()
  view: ToolLibraryView = ToolLibraryView.Main;

  @state()
  detailView: ToolDetailView = ToolDetailView.Description;

  @query('#install-tool-dialog')
  _installToolDialog!: InstallToolDialogWeb2;

  @query('#select-group')
  _selectGroup!: SelectGroup;

  @query('#curation-dialog')
  _curationListDialog!: MossDialog;

  @query('#curation-manager')
  _curationManagerDialog!: UrlListManager;

  @state()
  _selectedTool: ToolAndCurationInfo | undefined;

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @state()
  allDeveloperCollectives: Record<ToolListUrl, DeveloperCollective> = {};

  @state()
  availableTools: Record<ToolCompatibilityId, ToolAndCurationInfo> = {};

  @state()
  curationLists: { curator: ToolCurator; list: ToolCurationList }[] = [];

  @state()
  _toolCurationConfigs: ToolCurationConfig[] = [];

  @state()
  unifiedTools: Map<string, UnifiedToolEntry> = new Map();

  @state()
  classification = 'all';

  @state()
  sortMode: 'releaseDesc' | 'releaseAsc' | 'alphaAsc' | 'alphaDesc' = 'releaseDesc';

  // Empty string means "all tags" (no tag filtering).
  @state()
  selectedTag = '';

  /** */
  async firstUpdated() {
    /** Set initial config */
    // why: an explicit --tool-curation-url CLI override (used by the E2E test
    // harness) takes precedence over both dev config and persisted user config,
    // so a test can deterministically point at a local fixture.
    const cliOverride = await window.electronAPI.getToolCurationOverride();
    // In applet dev mode, we use a fake list generated from the weave.dev.config
    if (cliOverride) {
      this._toolCurationConfigs = [{ url: cliOverride, useLists: ['default'] }];
    } else if (!!this.mossStore.appletDevConfig) {
      this._toolCurationConfigs = this.mossStore.appletDevConfig.toolCurations;
    } else {
      // Get list of lists from localStorage
      const json: string | null = window.localStorage.getItem('mossCurationConfig');
      if (json) {
        try {
          const urls = JSON.parse(json) as string[];
          this._toolCurationConfigs = urls.map((url) => ({ url, useLists: ['default'] })); // TODO: handle multiple useLists
        } catch {
          this._toolCurationConfigs = DEFAULT_PRODUCTION_TOOL_CURATION_CONFIGS;
        }
      } else {
        // If none, use default
        this._toolCurationConfigs = DEFAULT_PRODUCTION_TOOL_CURATION_CONFIGS;
      }
    }
    /** Initialize curation list manager */
    await this._curationManagerDialog.initializeList(this._toolCurationConfigs.map((i) => i.url));
    /** Load tools from config */
    await this.fetchToolLists();
  }

  /** */
  async fetchToolLists() {
    const result = await fetchUnifiedTools(
      this._toolCurationConfigs,
      this.mossStore.devModeToolLibrary,
    );
    this.unifiedTools = result.unifiedTools;
    this.allDeveloperCollectives = result.developerCollectives;
    this.availableTools = result.availableTools;
    this.curationLists = result.curationLists;
  }

  resetView() {
    this.view = ToolLibraryView.Main;
  }

  renderMainView() {
    const unifiedToolsArray = Array.from(this.unifiedTools.values());
    const classificationFiltered =
      this.classification === 'all'
        ? unifiedToolsArray
        : this.classification === 'stable'
          ? unifiedToolsArray.filter((entry) => {
              const primary = getPrimaryVersionBranch(entry);
              return primary && primary.curationInfos[0]?.info.visiblity !== 'low';
            })
          : unifiedToolsArray.filter((entry) => {
              const primary = getPrimaryVersionBranch(entry);
              return primary && primary.curationInfos[0]?.info.visiblity === 'low';
            });
    // Offer every tag present across the (classification-filtered) tools, so the
    // tag options track the current classification view.
    const availableTags = Array.from(
      new Set(classificationFiltered.flatMap((entry) => entry.tags)),
    ).sort((a, b) => a.localeCompare(b));
    // If the selected tag is no longer offered (e.g. classification changed),
    // fall back to showing all tools rather than an empty list.
    const activeTag =
      this.selectedTag && availableTags.includes(this.selectedTag) ? this.selectedTag : '';
    const filteredUnifiedTools = activeTag
      ? classificationFiltered.filter((entry) => entry.tags.includes(activeTag))
      : classificationFiltered;
    return html`
      <div class="column" style="display: flex; margin: 16px; flex: 1;">
        <div class="row items-center" style="gap: 12px; justify-content: center;">
          <label class="row items-center sort-control">
            <span style="margin-right: 6px; opacity: 0.6;">${msg('Sort by')}</span>
            <select
              class="sort-select"
              @change=${(e: Event) => {
                this.sortMode = (e.target as HTMLSelectElement).value as typeof this.sortMode;
              }}
            >
              <option value="releaseDesc" ?selected=${this.sortMode === 'releaseDesc'}>
                ${msg('Newest first')}
              </option>
              <option value="releaseAsc" ?selected=${this.sortMode === 'releaseAsc'}>
                ${msg('Oldest first')}
              </option>
              <option value="alphaAsc" ?selected=${this.sortMode === 'alphaAsc'}>
                ${msg('Name (A–Z)')}
              </option>
              <option value="alphaDesc" ?selected=${this.sortMode === 'alphaDesc'}>
                ${msg('Name (Z–A)')}
              </option>
            </select>
          </label>
          ${availableTags.length > 0
            ? html`
                <label class="row items-center sort-control">
                  <span style="margin-right: 6px; opacity: 0.6;">${msg('Tag')}</span>
                  <select
                    class="sort-select"
                    @change=${(e: Event) => {
                      this.selectedTag = (e.target as HTMLSelectElement).value;
                    }}
                  >
                    <option value="" ?selected=${activeTag === ''}>${msg('All tags')}</option>
                    ${availableTags.map(
                      (tag) =>
                        html`<option value=${tag} ?selected=${activeTag === tag}>${tag}</option>`,
                    )}
                  </select>
                </label>
              `
            : ''}
          <div class="tool-classification-selector">
            <button
              class="classification-button classification-button-all ${this.classification === 'all'
                ? 'classification-active'
                : ''}"
              @click=${async () => (this.classification = 'all')}
            >
              ${appStoreIcon(16)} <span style="margin-left:5px">${msg('all tools')}</span>
            </button>
            <sl-tooltip .content=${msg('Tested and loved tools.')}>
              <button
                class="classification-button classification-button-stable ${this.classification ===
                'stable'
                  ? 'classification-active'
                  : ''}"
                @click=${async () => (this.classification = 'stable')}
              >
                ${stableToolIcon(16)} ${msg('stable')}
              </button></sl-tooltip
            >
            <sl-tooltip .content=${msg('Fun, but may glitch!')}>
              <button
                class="classification-button classification-button-experimental ${this
                  .classification === 'experimental'
                  ? 'classification-active'
                  : ''}"
                @click=${async () => (this.classification = 'experimental')}
              >
                ${experimentalToolIcon(16)} ${msg('experimental')}
              </button></sl-tooltip
            >
          </div>
        </div>
        <installable-tools-web2
          style="display: flex; flex: 1;"
          .devCollectives=${this.allDeveloperCollectives}
          .unifiedTools=${filteredUnifiedTools}
          .sortMode=${this.sortMode}
          @install-tool-to-group=${(e) => {
            // Handle both old format (tool) and new format (unifiedTool + versionBranch)
            if (e.detail.unifiedTool) {
              const versionBranch = e.detail.versionBranch;
              const branchInfo = e.detail.unifiedTool.versionBranches.get(versionBranch);
              if (branchInfo) {
                // Convert to ToolAndCurationInfo for the install dialog (backward compatibility)
                const toolForDialog: ToolAndCurationInfo = {
                  toolCompatibilityId: branchInfo.toolCompatibilityId,
                  toolInfoAndVersions: branchInfo.toolInfoAndVersions,
                  latestVersion: branchInfo.latestVersion,
                  curationInfos: branchInfo.curationInfos,
                  toolListUrl: e.detail.unifiedTool.toolListUrl,
                  developerCollectiveId: e.detail.unifiedTool.developerCollectiveId,
                };
                this._selectedTool = toolForDialog;
                this._selectedGroupDnaHash = e.detail.groupDnaHash;
                setTimeout(async () => this._installToolDialog.open(this._selectedTool!), 50);
              }
            } else if (e.detail.tool) {
              // Old format for backward compatibility
              this._selectedTool = e.detail.tool;
              this._selectedGroupDnaHash = e.detail.groupDnaHash;
              setTimeout(async () => this._installToolDialog.open(this._selectedTool!), 50);
            }
          }}
          @applet-installed=${(_e) => {
            console.log('@group-home: GOT APPLET INSTALLED EVENT.');
            this.view = ToolLibraryView.Main;
            this.detailView = ToolDetailView.Description;
            // re-dispatch event since for some reason it doesn't bubble further
            // this.dispatchEvent(
            //   new CustomEvent("applet-installed", {
            //     detail: e.detail,
            //     composed: true,
            //     bubbles: true,
            //   })
            // );
          }}
        ></installable-tools-web2>
      </div>
    `;
  }

  renderToolDetail() {
    if (!this._selectedTool) return html`No Tool selected.`;
    return html`
      <div class="column" style="flex: 1;">
        <div class="row detail-header">
          <div class="row" style="align-items: center; flex: 1;">
            <img
              src=${this._selectedTool.toolInfoAndVersions.icon}
              alt="${this._selectedTool.toolInfoAndVersions.title} tool icon"
              style="height: 130px; width: 130px; border-radius: 10px; margin-right: 15px;"
            />
            <div class="column" style="margin-left: 30px;">
              <div class="row" style="align-items: flex-end;">
                <div style="font-size: 30px; font-weight: bold;">
                  ${this._selectedTool.toolInfoAndVersions.title}
                </div>
                <div style="font-size: 25px; margin-left: 10px;">
                  ${this._selectedTool.latestVersion.version}
                </div>
              </div>
              <div style="font-size: 24px;">${this._selectedTool.toolInfoAndVersions.subtitle}</div>
            </div>
            <span style="display: flex; flex: 1;"></span>
            <button
              class="moss-button"
              style="background: white; color: black;"
              @click=${async () => this._selectGroup.show()}
              </button>>
              ${msg('+ Add to Group')}
            </button>
          </div>
        </div>
        <div class="body">${this.renderDetailBody()}</div>
      </div>
    `;
  }

  /** */
  renderCurationLists() {
    return html`
      <moss-dialog id="curation-dialog" width="870px" headerAlign="center">
        <span slot="header">${msg('Tool Curation Lists')}</span>
        <div slot="content">
          <curation-list-manager
            id="curation-manager"
            @urls-changed=${async (e) => {
              const urls = e.detail.map((url: NamedUrl) => url.url);
              this._toolCurationConfigs = urls.map((url: string) => {
                return { url, useLists: ['default'] };
              });
              await this.fetchToolLists();
              window.localStorage.setItem('mossCurationConfig', JSON.stringify(urls));
            }}
          ></curation-list-manager>
        </div>
      </moss-dialog>
    `;
  }

  /** */
  renderPublisher(publisher: DeveloperCollective | undefined) {
    if (!publisher) return html``;

    return html`
      <div class="column">
        <div class="row" style="align-items: center; font-size: 1.1rem;">
          <img
            alt=${publisher.name}
            .src=${publisher.icon}
            style="width: 40px; height: 40px; border-radius: 50%;"
          />
          <div style="margin-left: 10px; font-size: 1.2rem;">${publisher.name}</div>
        </div>
        <div style="margin-top: 20px; opacity: 0.8;">${publisher.description}</div>
        <div class="row" style="align-items: center; margin-top: 20px;">
          <sl-icon
            style="font-size: 1.3rem; margin-right: 2px;"
            .src=${wrapPathInSvg(mdiWeb)}
          ></sl-icon>
          <span style="margin-right: 10px;">${msg('Website')}:</span>
          ${publisher.contact.website && publisher.contact.website !== ''
            ? html`<span
                ><a href="${publisher.contact.website}">${publisher.contact.website}</a></span
              >`
            : html`<span>N/A</span>`}
        </div>
        <div class="row" style="align-items: center; margin-top: 8px;">
          <sl-icon
            style="font-size: 1.3rem; margin-right: 2px;"
            .src=${wrapPathInSvg(mdiEmailOutline)}
          ></sl-icon>
          <span style="margin-right: 10px;">${msg('Contact')}:</span>
          ${publisher.contact.email && publisher.contact.email !== ''
            ? html` <span>${publisher.contact.email}</span> `
            : html`<span>N/A</span>`}
        </div>
      </div>
    `;
  }

  renderDetailBody() {
    if (!this._selectedTool) return html`No Tool selected.`;
    switch (this.detailView) {
      case ToolDetailView.Description:
        return html`
          <div class="column">
            <div style="font-size: 20px; margin-bottom: 20px;">
              ${this._selectedTool.toolInfoAndVersions.description}
            </div>
            <h3>${msg('Published by:')}</h3>
            ${this.renderPublisher(this.allDeveloperCollectives[this._selectedTool.toolListUrl])}
          </div>
        `;
      default:
        return html`Nothing here.`;
    }
  }

  /** */
  renderContent() {
    switch (this.view) {
      case ToolLibraryView.Main:
        return this.renderMainView();
      //case ToolLibraryView.ToolDetail:
      //  return this.renderToolDetail();
    }
  }

  /** */
  render() {
    return html`
      ${this.renderCurationLists()}
      <group-context
        .groupDnaHash=${this._selectedGroupDnaHash
          ? decodeHashFromBase64(this._selectedGroupDnaHash)
          : undefined}
      >
        <install-tool-dialog-web2
          id="install-tool-dialog"
          @install-tool-dialog-closed=${() => {
            this._selectedGroupDnaHash = undefined;
            this._selectedTool = undefined;
          }}
          @applet-installed=${() => {
            this._selectedGroupDnaHash = undefined;
            this._selectedTool = undefined;
            this.view = ToolLibraryView.Main;
            this.detailView = ToolDetailView.Description;
          }}
        ></install-tool-dialog-web2>
      </group-context>
      <div class="column container" style="flex: 1;">
        <div class="header column center-content">
          <div class="row" style="align-items: center; font-size: 34px;">
            <span style="flex: 1; margin-left: 10px; font-weight: bold;">
              ${msg('Tool Library')}
            </span>
          </div>
          <button
            class="moss-button"
            style="border-radius:8px; padding: 8px 10px;position: absolute; right: 20px;border: 1px solid #89D6AA; color: #89D6AA"
            @click=${() => {
              this._curationListDialog.show();
            }}
          >
            <div class="row items-center">
              ${devIcon(14)}
              <span style="margin-left: 5px;font-size: 12px; ">${msg('Tool Sources')}</span>
            </div>
          </button>
        </div>
        <div class="column flex-scrollable-parent" style="position:relative">
          <div class="flex-scrollable-container">
            <div class="column flex-scrollable-y">${this.renderContent()}</div>
          </div>
        </div>
      </div>
    `;
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
        /* background-color: var(--moss-dark-green); */
        overflow: auto;
        padding: 8px;
        border-radius: 8px;
      }

      .container {
        /* background: var(--sl-color-tertiary-0); */
        border-radius: 8px;
        overflow: hidden;
      }

      .header {
        height: 70px;
        /* background: var(--sl-color-tertiary-950); */
      }

      .detail-header {
        align-items: center;
        padding: 30px;
        height: 200px;
        color: var(--sl-color-tertiary-0);
        /* background: linear-gradient(var(--sl-color-tertiary-600), var(--sl-color-tertiary-700)); */
        background: #ffffff40;
        border-radius: 10px;
      }

      .body {
        flex: 1;
        /* background: linear-gradient(var(--sl-color-tertiary-300), #9fa9c1); */
        padding: 30px;
      }

      .back-btn {
        --sl-color-neutral-600: white;
        --sl-color-primary-600: var(--sl-color-tertiary-600);
        --sl-color-primary-700: var(--sl-color-tertiary-700);
      }

      .back-btn:hover {
        color: black;
      }

      .install-btn {
        all: unset;
        cursor: pointer;
        font-size: 1.5rem;
        background: var(--sl-color-tertiary-50);
        height: 50px;
        border-radius: 30px;
        padding: 0 30px;
        color: var(--sl-color-tertiary-950);
      }

      .install-btn:hover {
        background: var(--sl-color-tertiary-200);
      }

      .install-btn:focus {
        background: var(--sl-color-tertiary-200);
        outline: 2px solid var(--sl-color-tertiary-950);
      }

      .btn {
        all: unset;
        margin: 12px;
        font-size: 25px;
        height: 100px;
        min-width: 300px;
        background: var(--sl-color-primary-800);
        border-radius: 10px;
        cursor: pointer;
        box-shadow: 0 2px 5px var(--sl-color-primary-900);
      }

      .btn:hover {
        background: var(--sl-color-primary-700);
      }

      .btn:active {
        background: var(--sl-color-primary-600);
      }

      .tool-classification-selector {
        border-radius: 8px;
        background-color: color(from var(--moss-hint-green) srgb r g b / 0.1);
        display: flex;
        flex-direction: row;

        justify-content: center;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
        padding: 3px 4px;
      }
      .classification-button {
        height: 32px;
        border-radius: 8px;
        padding: 8px 10px;
        border: none;
        color: rgba(0, 0, 0, 0.5);
        background-color: transparent;
        display: flex;
        flex-direction: row;
        align-items: center;
        cursor: pointer;
      }
      .classification-button:hover {
        color: black;
      }
      .classification-active {
        background-color: white;
        color: black;
      }
      .classification-disabled {
        color: rgba(0, 0, 0, 0.3);
      }
      .classification-button-active.classification-button-experimental {
        color: var(--moss-purple);
      }

      .sort-control {
        font-size: 13px;
      }
      .sort-select {
        height: 32px;
        border-radius: 8px;
        border: 1px solid color(from var(--moss-hint-green) srgb r g b / 0.4);
        background-color: white;
        color: black;
        padding: 0 8px;
        cursor: pointer;
        font-family: inherit;
        font-size: 13px;
      }
    `,
    mossStyles,
  ];
}
