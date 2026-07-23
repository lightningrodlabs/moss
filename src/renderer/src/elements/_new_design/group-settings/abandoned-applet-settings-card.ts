import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { localized } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import '../../../applets/elements/applet-logo';

import { chevronSingleDownIcon, chevronSingleUpIcon } from '../icons';
import { BaseAppletSettingsCard } from './base-applet-settings-card.js';

@localized()
@customElement('abandoned-applet-settings-card')
export class AbandonedAppletSettingsCard extends BaseAppletSettingsCard {

  protected renderTitleBarContent() {
    return html`
      <applet-logo
        .appletHash=${this.appletHash}
        style="margin-right: 16px; --size: 64px;"
      ></applet-logo>
      <div class="column">
        <div class="tool-name">${this.applet.custom_name}</div>
      </div>

      <span class="flex-1"></span>
      <div>${this.showDetails ? chevronSingleDownIcon(18) : chevronSingleUpIcon(18)}</div>
    `;
  }

  protected renderDetailsActions() {
    return html`
      ${this.renderAdvancedSettingsToggle()}
      <span class="flex flex-1"></span>
      <div class="row">
        ${this.renderDeprecateButton()}
      </div>
    `;
  }

  protected renderAdvancedSectionContent() {
    return html``;
  }

  static styles = [
    ...BaseAppletSettingsCard.styles,
  ];
}
