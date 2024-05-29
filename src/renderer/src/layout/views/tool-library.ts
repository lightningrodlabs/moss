import { html, LitElement, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
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
  @state()
  view: ToolLibraryView = ToolLibraryView.Main;

  @state()
  detailView: ToolDetailView = ToolDetailView.Description;

  @state()
  _selectedTool: UpdateableEntity<Tool> | undefined;

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
      <div class="column" style="flex: 1;">
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
        <div class="column" style="margin-top: 70px; flex: 1;">${this.renderContent()}</div>
      </div>
    `;
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
        background: var(--sl-color-tertiary-0);
        overflow: auto;
        color: var(--sl-color-secondary-950);
      }

      .header {
        color: white;
        height: 70px;
        background: var(--sl-color-tertiary-950);
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
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
