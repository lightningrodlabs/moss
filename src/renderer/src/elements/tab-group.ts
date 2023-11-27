import { html, LitElement, css, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import { weStyles } from '../shared-styles.js';

@localized()
@customElement('tab-group')
export class TabGroup extends LitElement {
  @property()
  tabs!: Array<[string, TemplateResult]>;

  @state()
  selectedTab: [string, TemplateResult] | undefined;

  // firstUpdated() {
  //   this.selectedTab = this.tabs[0];
  //   console.log("@tab-group: tabs: ", this.tabs);
  // }

  render() {
    if (!this.tabs || this.tabs.length === 0) {
      return html`<span>No tabs</span>`;
    } else {
      return html`
        <div class="column" style="position: relative; flex: 1;">
          <div class="row container" style="flex: 1;">
            <!-- sidebar -->
            <div class="column sidebar flex-scrollable-container">
              <div class="flex-scrollable-y">
                ${this.tabs.map(
                  (tab) =>
                    html` <div
                      class="row tab ${this.selectedTab === tab ||
                      (!this.selectedTab && tab === this.tabs[0])
                        ? 'selected'
                        : ''}"
                      tabindex="0"
                      @click=${() => {
                        this.selectedTab = tab;
                      }}
                      @keypress.enter=${() => {
                        this.selectedTab = tab;
                      }}
                    >
                      ${tab[0]}
                    </div>`,
                )}
              </div>
            </div>
            <div class="content flex-scrollable-container" style="display: flex; flex: 1;">
              ${this.selectedTab
                ? this.tabs.filter((tab) => tab === this.selectedTab)[0][1]
                : this.tabs[0][1]}
              <div></div>
            </div>
          </div>
        </div>
      `;
    }
  }

  static styles = [
    css`
      .container {
        --sidebar-width: 250px;
        --tab-height: 50px;
        --sidebar-border-radius: 0px;
      }

      .sidebar {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        width: var(--sidebar-width);
        background: var(--sl-color-primary-700);
        flex: 1;
        padding-top: 8px;
        border-radius: var(--sidebar-border-radius);
      }

      .tab {
        padding: 0 15px;
        align-items: center;
        border-radius: 10px;
        background: var(--sl-color-primary-200);
        margin: 0 8px 8px 8px;
        height: var(--tab-height);
        color: black;
        cursor: pointer;
        font-size: 18px;
      }

      .tab.selected {
        background: var(--sl-color-primary-500);
      }

      .tab:hover {
        background: var(--sl-color-primary-500);
      }

      .content {
        margin-left: var(--sidebar-width);
      }
    `,
    weStyles,
  ];
}
