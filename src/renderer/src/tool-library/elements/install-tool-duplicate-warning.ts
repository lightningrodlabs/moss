import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { AgentPubKey, EntryHash } from '@holochain/client';
import { AppletAgent } from '@theweave/group-client';
import { ToolInfoAndVersions } from '@theweave/moss-types';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';

import { mossStyles } from '../../shared-styles.js';
import { toolSettingsStyles } from '../../groups/elements/settings/tool-settings-styles.js';
import { getLocalizedTimeAgo } from '../../locales/localization.js';

export type MatchingInactiveTool = {
  toolHash: EntryHash;
  toolName: string;
  installerKey: AgentPubKey;
  timestamp: number;
  joinedMembers: AppletAgent[];
  toolInfoAndVersions: ToolInfoAndVersions | undefined;
};

/**
 * Shown by the install dialog when the group already has an inactive
 * instance of the Tool being added. Emits `create-new` or
 * `activate-existing` for the dialog to act on.
 */
@localized()
@customElement('install-tool-duplicate-warning')
export class InstallToolDuplicateWarning extends LitElement {
  @property({ attribute: false })
  info: MatchingInactiveTool | undefined;

  @property({ type: Boolean })
  activating = false;

  private emit(name: 'create-new' | 'activate-existing'): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  render() {
    const info = this.info;
    if (!info) return html``;
    const timeAgo = getLocalizedTimeAgo();

    return html`
      <div class="column" style="gap: 20px;">
        <div class="form-text" style="font-size: 16px; line-height: 1.5;">
          ${msg('That tool has already been added to the group.')}
          ${msg('Are you sure you want to create another instance of that tool?')}
        </div>

        <div class="column tool" style="flex: 1;">
          <div class="row" style="justify-content: space-between">
            <div class="row">
              ${info.toolInfoAndVersions?.icon
                ? html`<sl-tooltip content="${info.toolInfoAndVersions.description}">
                    <img
                      src=${info.toolInfoAndVersions.icon}
                      alt=${msg('Tool logo')}
                      style="height: 64px; width:64px; margin-right: 10px; border-radius:16px;"
                    />
                  </sl-tooltip>`
                : html``}
              <div class="column">
                <span class="tool-name">${info.toolName}</span>
                <span class="tool-short-description">${info.toolInfoAndVersions?.subtitle}</span>
              </div>
            </div>
          </div>
          <div class="details-container column">
            <div class="installer row">
              <agent-avatar
                .size=${24}
                style="margin-right: 5px;"
                .agentPubKey=${info.installerKey}
              ></agent-avatar>
              <span>${msg('installed this tool to the group space ')}</span>
              <div style="margin-left:5px;">${timeAgo.format(new Date(info.timestamp / 1000))}</div>
            </div>
            ${info.joinedMembers.length > 0
              ? html`<div class="participants row">
                  <span style="margin-right: 5px;">${msg('In use by: ')}</span>
                  ${info.joinedMembers.map(
                    (appletAgent) => html`
                      <agent-avatar
                        style="margin-left: 5px;"
                        .size=${24}
                        .agentPubKey=${appletAgent.group_pubkey}
                      ></agent-avatar>
                    `,
                  )}
                </div>`
              : ''}
          </div>
        </div>

        <div class="row" style="gap: 12px; justify-content: flex-end; margin-top: 10px;">
          <button
            class="moss-button-secondary"
            style="padding: 10px 20px; font-size: 16px;"
            ?disabled=${this.activating}
            @click=${() => this.emit('create-new')}
          >
            ${msg('Create New')}
          </button>
          <button
            class="moss-button"
            style="padding: 10px 20px; font-size: 16px;"
            ?disabled=${this.activating}
            @click=${() => this.emit('activate-existing')}
          >
            ${this.activating
              ? html`<sl-spinner style="font-size: 16px;"></sl-spinner>`
              : msg('Activate Existing')}
          </button>
        </div>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    toolSettingsStyles,
    css`
      .form-text {
        color: rgba(0, 0, 0, 0.6);
        font-size: 16px;
        font-style: normal;
        font-weight: 400;
        line-height: 24px;
      }
    `,
  ];
}
