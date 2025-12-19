import { StoreSubscriber } from '@holochain-open-dev/stores';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../../groups/elements/group-context.js';
import './topbar-button.js';
import '../dialogs/create-group-dialog.js';
import '../../applets/elements/applet-logo-raw.js';

import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { mossStyles } from '../../shared-styles.js';
import { ToolCompatibilityId } from '@theweave/api';

// Sidebar for the applet instances of a group
@localized()
@customElement('tool-personal-bar-button')
export class PersonalViewSidebar extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @property()
  toolCompatibilityId!: ToolCompatibilityId;

  @property()
  selected = false;

  toolBundle = new StoreSubscriber(
    this,
    () => this._mossStore.appletClassInfo.get(this.toolCompatibilityId),
    () => [this.toolCompatibilityId],
  );

  render() {
    return html`
      <topbar-button
        .invertColors=${true}
        style="margin-left: -4px; position: relative;"
        .selected=${this.selected}
        .tooltipText=${this.toolBundle.value.status === 'complete'
          ? this.toolBundle.value.value?.toolName
          : undefined}
        placement="bottom"
      >
        <applet-logo-raw
          class="applet-icon"
          .toolIdentifier=${{
            type: 'class',
            toolCompatibilityId: this.toolCompatibilityId,
          }}
          placement="bottom"
          style="--size: 48px; --border-radius: 8px;"
        >
        </applet-logo-raw>
      </topbar-button>
      <!-- </sl-tooltip> -->
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }

      .applet-icon {
        /* box-shadow: 0 0 2px 3px var(--sl-color-primary-400); */
        /* box-shadow: 1px 2px 10px 0px #102520ab; */
        border-radius: 8px;
      }
    `,
  ];
}
