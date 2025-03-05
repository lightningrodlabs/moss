import { html, LitElement, css } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { compareVersions, validate as validateSemver } from 'compare-versions';
import {
  DeveloperCollecive,
  DeveloperCollectiveToolList,
  ToolCompatibilityId,
  ToolCurationConfig,
  ToolCurationList,
  ToolCurations,
  ToolCurator,
} from '@theweave/moss-types';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/dialogs/select-group-dialog.js';
import { mdiChevronLeft, mdiEmailOutline, mdiPublish, mdiTools, mdiWeb } from '@mdi/js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import './elements/installable-tools-web2.js';
import './elements/tool-publisher-detail.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { DevModeToolLibrary, MossStore } from '../../moss-store.js';
import { groupStoreContext } from '../../groups/context.js';
import { GroupStore } from '../../groups/group-store.js';
import { SelectGroupDialog } from '../../elements/dialogs/select-group-dialog.js';
import { DnaHashB64, decodeHashFromBase64 } from '@holochain/client';
import { InstallToolDialogWeb2 } from './elements/install-tool-dialog-web2.js';
import './elements/install-tool-dialog-web2.js';
import { ToolAndCurationInfo, ToolListUrl } from '../../types';
import { deriveToolCompatibilityId } from '@theweave/utils';
import { SlDialog, SlSwitch } from '@shoelace-style/shoelace';

const PRODUCTION_TOOL_CURATION_CONFIGS: ToolCurationConfig[] = [
  {
    url: 'https://lightningrodlabs.org/weave-tool-curation/0.13/curations-0.13.json',
    useLists: ['default'],
  },
];

enum ToolLibraryView {
  Main,
  ToolDetail,
}

enum ToolDetailView {
  Description,
  VersionHistory,
  PublisherInfo,
}

@localized()
@customElement('tool-library-web2')
export class ToolLibraryWeb2 extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore: GroupStore | undefined; // will only be defined if the tools library is being accessed from within a group

  @state()
  view: ToolLibraryView = ToolLibraryView.Main;

  @state()
  detailView: ToolDetailView = ToolDetailView.Description;

  @query('#install-tool-dialog')
  _installToolDialog!: InstallToolDialogWeb2;

  @query('#select-group-dialog')
  _selectGroupDialog!: SelectGroupDialog;

  @query('#publish-dialog')
  _publishDialog!: SlDialog;

  @query('#visibility-switch')
  _visibilitySwitch: SlSwitch | undefined;

  @state()
  _selectedTool: ToolAndCurationInfo | undefined;

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  @state()
  allDeveloperCollectives: Record<ToolListUrl, DeveloperCollecive> = {};

  @state()
  availableTools: Record<ToolCompatibilityId, ToolAndCurationInfo> = {};

  @state()
  showLowVisbility = false;

  async firstUpdated() {
    // TODO Option to add additional curator URLs and store them to localstorage

    const allTools: Record<ToolCompatibilityId, ToolAndCurationInfo> = {};
    const developerCollectives: Record<ToolListUrl, DeveloperCollecive> = {};

    let toolCurationConfigs: ToolCurationConfig[];
    // In applet dev mode, we use a fake list generated from the weave.dev.config
    if (!!this.mossStore.appletDevConfig) {
      toolCurationConfigs = this.mossStore.appletDevConfig.toolCurations;
      const { tools, devCollective } = this.mossStore.devModeToolLibrary as DevModeToolLibrary; // should always be defined in dev mode
      tools.forEach((tool) => {
        allTools[tool.toolCompatibilityId] = tool;
        developerCollectives[tool.toolListUrl] = devCollective;
      });
    } else {
      toolCurationConfigs = PRODUCTION_TOOL_CURATION_CONFIGS;
      // TODO read curation URLs from localStorage here
    }

    // 1. Fetch all the curation lists from all the curators
    const curationLists: { curator: ToolCurator; list: ToolCurationList }[] = [];
    await Promise.allSettled(
      toolCurationConfigs.map(async (config) => {
        try {
          const resp = await fetch(config.url, { cache: 'no-cache' });
          const toolCurations: ToolCurations = await resp.json();
          // TODO validate format strictly here
          config.useLists.forEach((listName) => {
            const relevantList = toolCurations.curationLists[listName];
            if (relevantList) {
              curationLists.push({
                curator: toolCurations.curator,
                list: relevantList,
              });
            }
          });
        } catch (e) {
          console.warn(
            "Failed to fetch, parse or validate curator's list from url ",
            config.url,
            ':',
            e,
          );
        }
      }),
    );

    // 2. Identify all distinct tool lists and fetch them
    const toolLists: Record<ToolListUrl, DeveloperCollectiveToolList> = {};
    const distinctToolListUrls = Array.from(
      new Set(curationLists.map((list) => list.list.tools.map((tool) => tool.toolListUrl)).flat()),
    );
    console.log('curationLists: ', curationLists);

    console.log('distinctToolListUrls: ', distinctToolListUrls);

    await Promise.allSettled(
      distinctToolListUrls.map(async (url) => {
        try {
          const resp = await fetch(url, { cache: 'no-cache' });
          const toolList: DeveloperCollectiveToolList = await resp.json();
          console.log('Fetched tool list: ', toolList);
          toolLists[url] = toolList;
          developerCollectives[url] = toolList.developerCollective;
        } catch (e) {
          console.warn('Failed to fetch, parse or validate Tool list from url ', url, ':', e);
        }
      }),
    );

    // For each curated Tool, extract the relevant information
    curationLists.forEach(({ curator, list }) => {
      list.tools.forEach((curatedTool) => {
        const toolList = toolLists[curatedTool.toolListUrl];
        if (!toolList) return;
        const relevantTool = toolList.tools.find(
          (tool) =>
            tool.id === curatedTool.toolId && tool.versionBranch === curatedTool.versionBranch,
        );
        if (!relevantTool) return;
        const latestVersion = relevantTool.versions
          .filter((version) => validateSemver(version.version))
          .sort((version_a, version_b) => compareVersions(version_b.version, version_a.version))[0];
        if (!latestVersion) return;
        const toolCompatibilityId = deriveToolCompatibilityId({
          toolListUrl: curatedTool.toolListUrl,
          toolId: relevantTool.id,
          versionBranch: relevantTool.versionBranch,
        });
        let toolAndCurationInfo = allTools[toolCompatibilityId];
        if (toolAndCurationInfo) {
          toolAndCurationInfo.curationInfos.push({
            info: curatedTool,
            curator,
          });
        } else {
          toolAndCurationInfo = {
            toolCompatibilityId,
            toolInfoAndVersions: relevantTool,
            toolListUrl: curatedTool.toolListUrl,
            latestVersion,
            developerCollectiveId: toolList.developerCollective.id,
            curationInfos: [
              {
                info: curatedTool,
                curator,
              },
            ],
          };
        }
        allTools[toolCompatibilityId] = toolAndCurationInfo;
      });
    });

    console.log('AVAILABLE TOOLS: ', allTools);

    this.allDeveloperCollectives = developerCollectives;
    this.availableTools = allTools;
  }

  resetView() {
    this.view = ToolLibraryView.Main;
  }

  renderMainView() {
    const availableTools = this.showLowVisbility
      ? Object.values(this.availableTools)
      : Object.values(this.availableTools).filter(
          (info) => info.curationInfos[0].info.visiblity !== 'low',
        );
    return html`
      <div class="column" style="display: flex; margin: 16px; flex: 1;">
        <div class="row items-center">
          <div class="flex flex-1"></div>
          <div style="margin-right: 10px;">${msg('Show experimental Tools')}</div>
          <sl-switch
            id="visibility-switch"
            @sl-change=${() => {
              this.showLowVisbility = this._visibilitySwitch!.checked;
            }}
          ></sl-switch>
        </div>
        <installable-tools-web2
          style="display: flex; flex: 1; overflow-y: auto;"
          .devCollectives=${this.allDeveloperCollectives}
          .installableTools=${availableTools}
          @open-tool-detail-web2=${(e) => {
            this._selectedTool = e.detail;
            this.view = ToolLibraryView.ToolDetail;
          }}
          @applet-installed=${(_e) => {
            // console.log("@group-home: GOT APPLET INSTALLED EVENT.");
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
              class="install-btn"
              @click=${async () => {
                this._selectGroupDialog.show();
              }}
            >
              ${msg('+ Add to Group')}
            </button>
          </div>
        </div>
        <div class="body">${this.renderDetailBody()}</div>
      </div>
    `;
  }

  renderPublisher(publisher: DeveloperCollecive | undefined) {
    if (!publisher) return html``;

    return html`
      <div class="column">
        <div class="row" style="align-items: center; font-size: 1.1rem;">
          <img
            alt="${publisher.name}"
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
            ? html`
                <span><a href="${publisher.contact.website}">${publisher.contact.website}</a></span>
              `
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

  renderPublishDialog() {
    return html` <sl-dialog id="publish-dialog" style="--width: 900px;" no-header>
      <div class="publish-dialog">
        <div
          class="row"
          style="align-items: center; font-size: 30px; justify-content: center; margin-bottom: 28px;"
        >
          <span style="margin-left: 5px;">Publish Tool</span>
        </div>
        <div style="max-width: 800px; margin-top: 20px; font-size: 20px;">
          To publish a Moss Tool it needs to be added to a Tool list hosted at a web2 URL. There is
          currently no detailed documentation about this process. You can check out the Tool list
          repository of Lightningrod Labs
          <a href="https://github.com/lightningrodlabs/weave-tool-curation">here</a>. <br /><br />
          If you would like to publish a Tool, please contact us at
          <a href="mailto:moss.0.13.feedback@theweave.social">moss.0.13.feedback@theweave.social</a>
          or
          <a href="https://github.com/lightningrodlabs/moss/issues/new"
            >create an issue on Github</a
          >
          so that we can assist you in setting up your own tool list.<br /><br />
        </div>
      </div>
    </sl-dialog>`;
  }

  renderContent() {
    switch (this.view) {
      case ToolLibraryView.Main:
        return this.renderMainView();
      case ToolLibraryView.ToolDetail:
        return this.renderToolDetail();
    }
  }

  render() {
    return html`
      <select-group-dialog
        id="select-group-dialog"
        @installation-group-selected=${(e: CustomEvent) => {
          this._selectedGroupDnaHash = e.detail;
          this._selectGroupDialog.hide();
          setTimeout(async () => this._installToolDialog.open(this._selectedTool!), 50);
        }}
      ></select-group-dialog>
      ${this.renderPublishDialog()}
      ${this._selectedGroupDnaHash
        ? html`
            <group-context .groupDnaHash=${decodeHashFromBase64(this._selectedGroupDnaHash)}>
              <install-tool-dialog-web2
                @install-tool-dialog-closed=${() => {
                  this._selectedGroupDnaHash = undefined;
                }}
                @applet-installed=${() => {
                  this._selectedGroupDnaHash = undefined;
                  this._selectedTool = undefined;
                  this.view = ToolLibraryView.Main;
                  this.detailView = ToolDetailView.Description;
                }}
                id="install-tool-dialog"
              ></install-tool-dialog-web2>
            </group-context>
          `
        : this.groupStore
          ? html`
              <install-tool-dialog-web2
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
                id="install-tool-dialog"
              ></install-tool-dialog-web2>
            `
          : html``}
      <div class="column container" style="flex: 1;">
        <div class="header column center-content">
          <sl-icon-button
            class="back-btn"
            .src=${wrapPathInSvg(mdiChevronLeft)}
            @click=${() => {
              this.view = ToolLibraryView.Main;
              this._selectedTool = undefined;
            }}
            style="font-size: 60px; position: absolute; left: 10px; ${!!this._selectedTool
              ? ''
              : 'display: none;'}"
          ></sl-icon-button>
          <div class="row" style="align-items: center; font-size: 34px;">
            <sl-icon .src=${wrapPathInSvg(mdiTools)}></sl-icon>
            <span style="flex: 1; margin-left: 10px;">${msg('Tool Library')}</span>
          </div>
          <sl-button
            style="position: absolute; right: 20px;"
            @click=${() => this._publishDialog.show()}
          >
            <div class="row items-center">
              <sl-icon .src=${wrapPathInSvg(mdiPublish)} style="font-size: 20px;"></sl-icon>
              <span style="margin-left: 5px;">${msg('Publish')}</span>
            </div>
          </sl-button>
        </div>
        <div class="column flex-scrollable-parent">
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
        background-color: #224b21;
        overflow: auto;
        color: var(--sl-color-secondary-950);
        padding: 8px;
        border-radius: 5px 0 0 0;
      }

      .container {
        background: var(--sl-color-tertiary-0);
      }

      .header {
        color: white;
        height: 70px;
        background: var(--sl-color-tertiary-950);
      }

      .detail-header {
        align-items: center;
        padding: 30px;
        height: 200px;
        color: var(--sl-color-tertiary-0);
        background: linear-gradient(var(--sl-color-tertiary-600), var(--sl-color-tertiary-700));
      }

      .body {
        flex: 1;
        background: linear-gradient(var(--sl-color-tertiary-300), #9fa9c1);
        padding: 30px;
        color: black;
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
        color: white;
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

      .publish-dialog {
        padding: 20px;
        border-radius: 20px;
        line-height: 1.2;
      }
    `,
    weStyles,
  ];
}
