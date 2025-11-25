import { Applet, AppletAgent } from '@theweave/group-client/dist/types.js';
import { DistributionInfo, TDistributionInfo, ToolInfoAndVersions } from '@theweave/moss-types';
import { AppletHash } from '@theweave/api';
import { pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { customElement, query, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { mossStoreContext } from '../../../context';
import { MossStore } from '../../../moss-store';
import { groupStoreContext } from '../../../groups/context';
import { GroupStore } from '../../../groups/group-store';
import { AgentPubKey, encodeHashToBase64 } from '@holochain/client';
import { notify, notifyError } from '@holochain-open-dev/elements';
import { mossStyles } from '../../../shared-styles';
import TimeAgo from 'javascript-time-ago';
import { Value } from '@sinclair/typebox/value';
import {
  activateToolIcon,
  chevronSingleDownIcon,
  chevronSingleUpIcon,
} from '../icons';
import '../moss-mini-button.js';
import { toolSettingsStyles } from './tool-settings-styles.js';
import { MossDialog } from '../moss-dialog.js';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

@localized()
@customElement('inactive-tools-dialog')
export class InactiveToolsDialog extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  @query('#dialog')
  _dialog!: MossDialog;

  _groupProfile = new StoreSubscriber(
    this,
    () => this._groupStore.groupProfile,
    () => [this._groupStore],
  );

  _unjoinedAppletsWithDetails = new StoreSubscriber(
    this,
    () =>
      pipe(this._groupStore.unjoinedApplets, async (appletsAndKeys) =>
        Promise.all(
          Array.from(appletsAndKeys.entries()).map(
            async ([appletHash, [agentKey, timestamp, joinedMembers]]) => {
              let appletEntry: Applet | undefined;
              try {
                appletEntry = await toPromise(this._groupStore.applets.get(appletHash));
              } catch (e) {
                console.warn('@inactive-tools-dialog @unjoined-applets: Failed to get appletEntry: ', e);
              }
              let toolInfoAndVersions: ToolInfoAndVersions | undefined;
              if (appletEntry) {
                const distributionInfo: DistributionInfo = JSON.parse(
                  appletEntry.distribution_info,
                );
                Value.Assert(TDistributionInfo, distributionInfo);
                if (distributionInfo.type === 'web2-tool-list') {
                  toolInfoAndVersions = await this._mossStore.toolInfoFromRemote(
                    distributionInfo.info.toolListUrl,
                    distributionInfo.info.toolId,
                    distributionInfo.info.versionBranch,
                  );
                }
              }
              return [
                appletHash,
                appletEntry,
                toolInfoAndVersions,
                agentKey,
                timestamp,
                joinedMembers,
              ] as [
                AppletHash,
                Applet | undefined,
                ToolInfoAndVersions | undefined,
                AgentPubKey,
                number,
                AppletAgent[],
              ];
            },
          ),
        ),
      ),
    () => [this._groupStore, this._mossStore],
  );

  @state()
  _joiningNewApplet: string | undefined;

  @state()
  expandedApplets = {};

  async show() {
    this._dialog.show();
  }

  async hide() {
    this._dialog.hide();
  }

  hasInactiveTools(): boolean {
    if (this._unjoinedAppletsWithDetails.value.status !== 'complete') return false;
    const ignoredApplets = this._mossStore.persistedStore.ignoredApplets.value(
      encodeHashToBase64(this._groupStore.groupDnaHash),
    );
    const filteredApplets = this._unjoinedAppletsWithDetails.value.value.filter(
      ([appletHash, _]) => {
        const hashB64 = encodeHashToBase64(appletHash);
        return !ignoredApplets || !ignoredApplets.includes(hashB64);
      },
    );
    return filteredApplets.length > 0;
  }

  async joinNewApplet(appletHash: AppletHash) {
    this._joiningNewApplet = encodeHashToBase64(appletHash);
    try {
      await this._groupStore.installApplet(appletHash);
      this.dispatchEvent(
        new CustomEvent('applet-installed', {
          detail: {
            appletEntryHash: appletHash,
            groupDnaHash: this._groupStore.groupDnaHash,
          },
          composed: true,
          bubbles: true,
        }),
      );
      notify('Tool activated.');
      // Check if there are still inactive tools, if not, close the dialog
      if (!this.hasInactiveTools()) {
        this.hide();
      }
    } catch (e) {
      notifyError(`Failed to activate tool (See console for details).`);
      console.error(e);
    }
    this._joiningNewApplet = undefined;
  }

  toggleExpandedApplets(hash: string) {
    this.expandedApplets[hash] = !this.expandedApplets[hash];
    this.requestUpdate();
  }

  renderInactiveTools() {
    switch (this._unjoinedAppletsWithDetails.value.status) {
      case 'pending':
        return html`<div class="column center-content">
          <sl-spinner style="font-size: 30px;"></sl-spinner>
        </div>`;
      case 'error':
        console.error('Failed to get unactivated applets: ', this._unjoinedAppletsWithDetails.value.error);
        return html`<div class="column center-content">
          <h3>Error: Failed to fetch unjoined Applets</h3>
          <span>${this._unjoinedAppletsWithDetails.value.error}</span>
        </div>`;
      case 'complete':
        const timeAgo = new TimeAgo('en-US');
        const ignoredApplets = this._mossStore.persistedStore.ignoredApplets.value(
          encodeHashToBase64(this._groupStore.groupDnaHash),
        );

        const filteredApplets = this._unjoinedAppletsWithDetails.value.value
          .map(
            ([
              appletHash,
              appletEntry,
              toolInfoAndVersions,
              agentKey,
              timestamp,
              joinedMembers,
            ]) => ({
              appletHash,
              appletEntry,
              toolInfoAndVersions,
              agentKey,
              timestamp,
              joinedMembers,
              isIgnored:
                !!ignoredApplets && ignoredApplets.includes(encodeHashToBase64(appletHash)),
            }),
          )
          .filter((info) => !info.isIgnored)
          .sort((info_a, info_b) => info_b.timestamp - info_a.timestamp);

        return html`
          <div class="column" style="max-height: 60vh; overflow-y: auto;">
            ${filteredApplets.length === 0
              ? html`
                  <div class="row center-content" style="flex: 1">
                    <span
                      class="placeholder"
                      style="margin: 24px; text-align: center; max-width: 600px; font-size: 16px;"
                      >${msg('No new tools to activate.')}
                    </span>
                  </div>
                `
              : html`
                  <div class="column">
                    ${filteredApplets.map(
                      (info) => html`
                        <div
                          class="column tool ${this.expandedApplets[encodeHashToBase64(info.appletHash)]
                            ? 'tool-expanded'
                            : ''}"
                          style="flex: 1;margin-bottom: 20px;"
                          @click=${() => {
                            this.toggleExpandedApplets(encodeHashToBase64(info.appletHash));
                          }}
                        >
                          <div class="row" style="justify-content: space-between">
                            <div class="row">
                              <sl-tooltip
                                style="${info.toolInfoAndVersions ? '' : 'display: none;'}"
                                content="${info.toolInfoAndVersions?.description}"
                              >
                                ${info.toolInfoAndVersions?.icon
                                  ? html`<img
                                      src=${info.toolInfoAndVersions.icon}
                                      alt="Applet logo"
                                      style="height: 64px; width:64px; margin-right: 10px; border-radius:16px;"
                                    />`
                                  : html``}
                              </sl-tooltip>
                              <div class="column">
                                <span class="tool-name"
                                  >${info.appletEntry ? info.appletEntry.custom_name : 'unknown'}</span
                                >
                                <span class="tool-short-description"
                                  >${info.toolInfoAndVersions?.subtitle}</span
                                >
                              </div>
                            </div>
                            <div class="buttons row" style="align-items:center">
                              <moss-mini-button
                                style="margin-left: 20px;"
                                .loading=${this._joiningNewApplet ===
                                  encodeHashToBase64(info.appletHash)}
                                .disabled=${!!this._joiningNewApplet}
                                @click=${(e: Event) => {
                                  e.stopPropagation();
                                  this.joinNewApplet(info.appletHash);
                                }}
                              >
                                ${activateToolIcon(20)}<span style="margin-left: 5px;"
                                  >${msg('Activate')}</span
                                >
                              </moss-mini-button>
                              <div style="margin-left: 24px">
                                ${this.expandedApplets[encodeHashToBase64(info.appletHash)]
                                  ? html`${chevronSingleDownIcon(18)}`
                                  : html`${chevronSingleUpIcon(18)}`}
                              </div>
                            </div>
                          </div>
                          ${this.expandedApplets[encodeHashToBase64(info.appletHash)]
                            ? html`
                                <div class="details-container column">
                                  <div class="installer row">
                                    <agent-avatar
                                      .size=${24}
                                      style="margin-right: 5px;"
                                      .agentPubKey=${info.agentKey}
                                    ></agent-avatar>
                                    <span>${msg('installed this tool to the group space ')}</span>
                                    <div style="margin-left:5px;">
                                      ${timeAgo.format(new Date(info.timestamp / 1000))}
                                    </div>
                                  </div>
                                  <div class="participants row">
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
                                  </div>
                                </div>
                            `
                            : ''}
                        </div>
                      `,
                    )}
                  </div>
                `}
          </div>
          <div class="full-width-border-wrapper">
            <div class="row">
              <button
                class="moss-button-secondary"
                style="width: 100%; padding: 12px; font-size: 16px; text-align: center;"
                @click=${() => {
                  this.hide();
                  this.dispatchEvent(
                    new CustomEvent('open-library-requested', {
                      detail: { groupHash: this._groupStore.groupDnaHash },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
              >
                ${msg('The tool I need is not listed. Take me to the Library.')}
              </button>
            </div>
          </div>
        `;
      default:
        return html``;
    }
  }

  getGroupName(): string {
    switch (this._groupProfile.value?.status) {
      case 'pending':
        return msg('...');
      case 'complete':
        return this._groupProfile.value.value?.name || msg('this group');
      case 'error':
        return msg('this group');
      default:
        return msg('this group');
    }
  }

  render() {
    return html`
      <moss-dialog
        id="dialog"
        headerAlign="left"
        width="800px"
      >
        <span slot="header">${msg('Before adding a new tool to')} ${this.getGroupName()}...</span>
        <div slot="content">
          <div class="column" style="margin-bottom: 24px;">
            <div class="subtitle" style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">
              ${msg('Check what your peers already use')}
            </div>
            <div class="description" style="font-size: 12px; opacity: 0.6; line-height: 1.5;">
              ${msg('They might have been already using a tool that you are looking for. No need to add it to your group space - just activate it for yourself and start collaborating!')}
            </div>
          </div>
          ${this.renderInactiveTools()}
        </div>
      </moss-dialog>
    `;
  }

  static styles = [
    mossStyles,
    toolSettingsStyles,
    css`
      .buttons {
        margin-right: 10px;
      }

      .full-width-border-wrapper {
        margin-left: -100px;
        margin-right: -100px;
        padding-left: 100px;
        padding-right: 100px;
        border-top: 1px solid var(--moss-grey-light);
        margin-top: 24px;
        padding-top: 24px;
      }
    `,
  ];
}

