import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { ToolAndCurationInfo } from '../../../types';
import { mossStyles } from '../../../shared-styles';
import { DeveloperCollective } from '@theweave/moss-types';
import { libraryStyles } from '../libraryStyles';

/**
 * @element library-tool-details
 */
@localized()
@customElement('library-tool-details')
export class LibraryToolDetails extends LitElement {
  // REQUIRED. The current Post record that should be updated
  @property()
  tool: ToolAndCurationInfo | undefined;

  @property()
  devCollectives: Record<string, DeveloperCollective> = {};

  renderVersion(version) {
    return html`<div class="column">
      <div class="version">v${version.version}</div>
      <div>Change Log: ${version.changelog}</div>
    </div>`;
  }

  render() {
    if (this.tool === undefined) {
      return 'NOTHING';
    }
    return html` <div class="column flex-1" style="padding: 40px 100px;">
      <div class="dialog-title" style="text-align: left; margin-bottom: 20px;">
        ${this.tool.toolInfoAndVersions.title}

        <div class="tool-developer">
          <span style="opacity:.4">by</span>
          <sl-tooltip content="visit developer’s website">
            <a href="${this.devCollectives[this.tool.toolListUrl].contact.website}"
              >${this.devCollectives[this.tool.toolListUrl].name}</a
            >
          </sl-tooltip>
        </div>
      </div>
      <div class="column" style="margin-top: 10px; min-height: 380px; overflow-y: auto;">
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
        <div class="tool-description" style="margin-top:25px;">
          ${this.tool.toolInfoAndVersions.description}
        </div>
        <div class="version-list">
          ${this.tool?.toolInfoAndVersions.versions.map((version) => this.renderVersion(version))}
        </div>
      </div>
    </div>`;
  }
  static styles = [
    mossStyles,
    libraryStyles,
    css`
      .version-list {
        margin-top: 25px;
      }
      .tool-developer {
        font-size: 16px;
      }
    `,
  ];
}
