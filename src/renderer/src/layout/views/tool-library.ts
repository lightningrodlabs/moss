import { html, LitElement, css } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { weStyles } from '../../shared-styles.js';
import '../../elements/select-group-dialog.js';
import { mdiChevronLeft, mdiTools } from '@mdi/js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import '../../groups/elements/installable-tools.js';
import '../../tool-bundles/elements/tool-publisher-detail.js';
import { Tool, UpdateableEntity } from '../../tools-library/types.js';
import { mossStoreContext } from '../../context.js';
import { consume } from '@lit/context';
import { MossStore } from '../../moss-store.js';
import { groupStoreContext } from '../../groups/context.js';
import { GroupStore } from '../../groups/group-store.js';
import { SelectGroupDialog } from '../../elements/select-group-dialog.js';
import { DnaHashB64, decodeHashFromBase64 } from '@holochain/client';
import { InstallToolDialog } from '../../groups/elements/install-tool-dialog.js';
import '../../groups/elements/install-tool-dialog.js';

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
@customElement('tool-library')
export class ToolLibrary extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  groupStore: GroupStore | undefined; // will only be defined if the tools library is being accessed from within a group

  @state()
  view: ToolLibraryView = ToolLibraryView.Main;

  @state()
  detailView: ToolDetailView = ToolDetailView.Description;

  @query('#install-tool-dialog')
  _installToolDialog!: InstallToolDialog;

  @query('#select-group-dialog')
  _selectGroupDialog!: SelectGroupDialog;

  @state()
  _selectedTool: UpdateableEntity<Tool> | undefined;

  @state()
  _selectedGroupDnaHash: DnaHashB64 | undefined;

  resetView() {
    this.view = ToolLibraryView.Main;
  }

  renderMainView() {
    return html`
      <div class="column" style="display: flex; margin: 16px; flex: 1">
        <installable-tools
          style="display: flex; flex: 1; overflow-y: auto;"
          @open-tool-detail=${(e) => {
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
        ></installable-tools>
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
              src=${this._selectedTool.record.entry.icon}
              alt="${this._selectedTool.record.entry.title} tool icon"
              style="height: 130px; width: 130px; border-radius: 10px; margin-right: 15px;"
            />
            <div class="column" style="margin-left: 30px;">
              <div class="row" style="align-items: flex-end;">
                <div style="font-size: 30px; font-weight: bold;">
                  ${this._selectedTool.record.entry.title}
                </div>
                <div style="font-size: 25px; margin-left: 10px;">
                  ${this._selectedTool.record.entry.version}
                </div>
              </div>
              <div style="font-size: 24px;">${this._selectedTool.record.entry.subtitle}</div>
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

  renderDetailBody() {
    if (!this._selectedTool) return html`No Tool selected.`;
    switch (this.detailView) {
      case ToolDetailView.Description:
        return html`
          <div class="column">
            <div style="font-size: 20px; margin-bottom: 20px;">
              ${this._selectedTool.record.entry.description}
            </div>
            <h3>${msg('Published by:')}</h3>
            <tool-publisher-detail
              style="margin-left: 5px;"
              .developerCollectiveHash=${this._selectedTool.record.entry.developer_collective}
            ></tool-publisher-detail>
          </div>
        `;
      default:
        return html`Nothing here.`;
    }
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
      ${this._selectedGroupDnaHash
        ? html`
            <group-context .groupDnaHash=${decodeHashFromBase64(this._selectedGroupDnaHash)}>
              <install-tool-dialog
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
              ></install-tool-dialog>
            </group-context>
          `
        : this.groupStore
          ? html`
              <install-tool-dialog
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
              ></install-tool-dialog>
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
        </div>
        <div class="column" style="flex: 1;">${this.renderContent()}</div>
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
    `,
    weStyles,
  ];
}
