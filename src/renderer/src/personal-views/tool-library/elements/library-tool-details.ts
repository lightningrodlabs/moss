import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { ToolAndCurationInfo } from '../../../types';
import { mossStyles } from '../../../shared-styles';
import { DeveloperCollective } from '@theweave/moss-types';
import { libraryStyles } from '../libraryStyles';
import TimeAgo from 'javascript-time-ago';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '../../../elements/_new_design/select-group.js';

enum TabsState {
  Overview,
  Versions,
}

/**
 * @element library-tool-details
 */
@localized()
@customElement('library-tool-details')
export class LibraryToolDetails extends LitElement {
  timeAgo = new TimeAgo('en-US');

  @property()
  tool: ToolAndCurationInfo | undefined;

  @property()
  devCollectives: Record<string, DeveloperCollective> = {};

  @state()
  tabsState: TabsState = TabsState.Overview;

  renderOverview() {
    return html`
      <div class="tool-description" style="margin-top:25px;">
        ${this.tool?.toolInfoAndVersions.description}
      </div>
    `;
  }

  renderVersion(version) {
    return html`<div class="column" style="margin-top: 10px;">
      <div class="version">v${version.version}</div>
      <div>
        Released:
        <sl-tooltip .content="${`${new Date(version.releasedAt)}`}">
          <span>${this.timeAgo.format(version.releasedAt)}</span></sl-tooltip
        >
      </div>
      <div>Change Log: ${version.changelog}</div>
    </div>`;
  }

  renderVersions() {
    return html`
      <div class="version-list">
        ${this.tool?.toolInfoAndVersions.versions.map((version) => this.renderVersion(version))}
      </div>
    `;
  }

  renderContent() {
    switch (this.tabsState) {
      case TabsState.Overview:
        return this.renderOverview();
      case TabsState.Versions:
        return this.renderVersions();
    }
  }

  render() {
    if (this.tool === undefined) {
      return 'NOTHING';
    }
    return html` 
      
      <div class="column" style="margin-top: 10px;">
        <div class="row" style="justify-content: space-between; align-items: center;">
          <div class="row">
            <img
              src=${this.tool.toolInfoAndVersions.icon}
              alt="${this.tool.toolInfoAndVersions.title} tool icon"
              style="height: 64px; width: 64px; border-radius: 16px; margin-right: 15px;"
            />
            <div class="column">
              ${this.tool.toolInfoAndVersions.subtitle}
              ${this.tool.toolInfoAndVersions.tags.length > 0
          ? html`
                    <div class="row tool-tag-list" style="margin-top:6px">
                      ${this.tool.toolInfoAndVersions.tags.map(
            (tag) => html`<div class="tool-tag">${tag}</div>`,
          )}
                    </div>
                  `
          : ''}
            </div>
          </div>
          <select-group
            .buttonWidth=${'auto'}
            .buttonText=${(() => {
              if (this.tool?.toolInfoAndVersions.versions && this.tool.toolInfoAndVersions.versions.length > 0) {
                const version = this.tool.toolInfoAndVersions.versions[0].version;
                return msg(`Install v${version} to a group space`);
              }
              return undefined;
            })()}
            @group-selected=${async (e: CustomEvent) => {
              this.dispatchEvent(
                new CustomEvent('install-tool-to-group', {
                  detail: { tool: this.tool, groupDnaHash: e.detail },
                  composed: true,
                }),
              );
            }}
          ></select-group>
        </div>
        <div class="row items-center tab-bar flex-1" style="margin-top:30px">
          <button
            class="tab ${this.tabsState === TabsState.Overview ? 'tab-selected' : ''}"
            @click=${() => {
        this.tabsState = TabsState.Overview;
      }}
          >
            ${msg('Overview')}
          </button>
          <button
            class="tab ${this.tabsState === TabsState.Versions ? 'tab-selected' : ''}"
            @click=${() => {
        this.tabsState = TabsState.Versions;
      }}
          >
            ${msg('Versions')}
          </button>
        </div>
        <div class="column">
          ${this.renderContent()}
        </div>
      </div>
    `;
  }
  static styles = [
    mossStyles,
    libraryStyles,
    css`
      .version-list {
        margin-top: 25px;
      }
    `,
  ];
}
