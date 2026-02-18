import { Applet, AppletAgent } from '@theweave/group-client/dist/types.js';
import { DistributionInfo, TDistributionInfo, ToolInfoAndVersions } from '@theweave/moss-types';
import { AppletHash, AppletId } from '@theweave/api';
import { pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import {localized, msg, str} from '@lit/localize';
import { mossStoreContext } from '../../../context';
import { MossStore } from '../../../moss-store';
import { groupStoreContext } from '../../../groups/context';
import { GroupStore } from '../../../groups/group-store';
import { AgentPubKey, encodeHashToBase64 } from '@holochain/client';
import { notify, notifyError } from '@holochain-open-dev/elements';
import { mossStyles } from '../../../shared-styles';
import { getLocalizedTimeAgo } from '../../../locales/localization.js';
import { Value } from '@sinclair/typebox/value';
import {
  activateToolIcon,
  chevronSingleDownIcon,
  chevronSingleUpIcon,
  ignoreToolIcon,
} from '../icons';
import '../moss-mini-button.js';
import { toolSettingsStyles } from './tool-settings-styles.js';

@localized()
@customElement('inactive-tools')
export class InactiveTools extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  @property({ type: Boolean })
  showIgnoredOnly = false;
  async joinNewApplet(appletHash: AppletHash) {
    this._joiningNewApplet = encodeHashToBase64(appletHash);
    try {
      await this._groupStore.installApplet(appletHash);

      // Only reload for single activations; batch activation reloads once at the end
      if (!this._activatingAll) {
        await this._mossStore.reloadManualStores();
      }

      // Don't dispatch 'applet-installed' event here to keep the settings window open
      // The event is only needed when installing from the tool library

      // Only show individual notification if not activating all
      if (!this._activatingAll) {
        notify(msg('Tool activated.'));
      }
      this._recentlyJoined.push(encodeHashToBase64(appletHash));
      //this._showIgnoredApplets = false;
    } catch (e) {
      notifyError(`Failed to activate tool (See console for details).`);
      console.error(e);
      throw e; // Re-throw to let activateAllTools handle it
    }
    this._joiningNewApplet = undefined;
  }

  _unjoinedApplets = new StoreSubscriber(
    this,
    () =>
      pipe(this._groupStore.unjoinedApplets, async (appletsAndKeys) =>
        Promise.all(
          Array.from(appletsAndKeys.entries()).map(
            async ([appletHash, [agentKey, timestamp]]) => {
              let appletEntry: Applet | undefined;
              try {
                appletEntry = await toPromise(this._groupStore.applets.get(appletHash)!);
              } catch (e) {
                console.warn('@inactive-tools @unjoined-applets: Failed to get appletEntry: ', e);
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
              let joinedMembers: AppletAgent[] = [];
              try {
                joinedMembers = await toPromise(this._groupStore.joinedAppletAgents.get(appletHash)!);
              } catch (e) {
                console.warn('@inactive-tools: Failed to get joined members: ', e);
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
  _recentlyJoined: Array<AppletId> = [];
  @state()
  _joiningNewApplet: string | undefined;
  @state()
  _activatingAll = false;
  @state()
  expandedApplets = {};
  toggleExpandedApplets(hash) {
    this.expandedApplets[hash] = !this.expandedApplets[hash];
    this.requestUpdate();
  }

  async activateAllTools(applets: Array<{ appletHash: AppletHash }>) {
    this._activatingAll = true;
    let successCount = 0;
    let failCount = 0;

    for (const applet of applets) {
      try {
        await this.joinNewApplet(applet.appletHash);
        successCount++;
      } catch (e) {
        failCount++;
        console.error('Failed to activate tool:', e);
      }
    }

    // Reload stores once after all activations complete
    await this._mossStore.reloadManualStores();

    this._activatingAll = false;

    if (failCount === 0) {
      notify(msg(str`Successfully activated all ${successCount} tools.`));
    } else if (successCount > 0) {
      notify(msg(str`Activated ${successCount} tools. ${failCount} failed (see console for details).`));
    } else {
      notifyError(msg(`Failed to activate all tools (see console for details).`));
    }
  }

  renderInactiveTools() {
    switch (this._unjoinedApplets.value.status) {
      // TODO handle loading and error case nicely
      case 'pending':
        return html`<div class="column center-content">
          <sl-spinner style="font-size: 30px;"></sl-spinner>
        </div>`;
      case 'error':
        console.error('Failed to get unactivated applets: ', this._unjoinedApplets.value.error);
        return html`<div class="column center-content">
          <h3>Error: Failed to fetch unjoined Applets</h3>
          <span>${this._unjoinedApplets.value.error}</span>
        </div> `;
      case 'complete':
        const timeAgo = getLocalizedTimeAgo();
        const ignoredApplets = this._mossStore.persistedStore.ignoredApplets.value(
          encodeHashToBase64(this._groupStore.groupDnaHash),
        );

        const filteredApplets = this._unjoinedApplets.value.value
          .filter(
            ([appletHash, _]) => !this._recentlyJoined.includes(encodeHashToBase64(appletHash)),
          )
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
          .filter((info) => {
            if (this.showIgnoredOnly) {
              return info.isIgnored;
            } else {
              return !info.isIgnored;
            }
          })
          .sort((info_a, info_b) => info_b.timestamp - info_a.timestamp);

        return html` ${filteredApplets.length === 0
          ? html`
              <div class="row center-content" style="flex: 1">
                <span
                  class="placeholder"
                  style="margin: 24px; text-align: center; max-width: 600px; font-size: 16px;"
                  >${this.showIgnoredOnly
                    ? msg('No ignored tools.')
                    : msg('No new tools to activate.')}
                </span>
              </div>
            `
          : html`
              <div class="column" style="position: relative;">
                ${filteredApplets.length > 1 && !this.showIgnoredOnly
                  ? html`
                      <div class="row" style="justify-content: flex-end; margin-bottom: 16px;">
                        <moss-mini-button
                          .loading=${this._activatingAll}
                          .disabled=${!!this._joiningNewApplet || this._activatingAll}
                          @click=${() => this.activateAllTools(filteredApplets)}
                        >
                          ${activateToolIcon(20)}<span style="margin-left: 5px;"
                            >${msg('Activate All')}</span
                          >
                        </moss-mini-button>
                      </div>
                    `
                  : html``}
                ${(this._joiningNewApplet || this._activatingAll)
                  ? html`<div class="activation-overlay"></div>`
                  : html``}
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
                                  alt=${msg("Tool logo")}
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
                            .disabled=${!!this._joiningNewApplet || this._activatingAll}
                            @click=${(e) => {
                e.stopPropagation();
                this.joinNewApplet(info.appletHash);
              }}
                          >
                            ${activateToolIcon(20)}<span style="margin-left: 5px;"
                              >${msg('Activate')}</span
                            >
                          </moss-mini-button>
                          ${info.isIgnored
                ? html``
                : html`
                                <moss-mini-button
                                  variant="secondary"
                                  style="margin-left: 8px;"
                                  .disabled=${!!this._joiningNewApplet || this._activatingAll}
                                  @click=${(e) => {
                    e.stopPropagation();
                    this._groupStore.ignoreApplet(info.appletHash);
                    this.requestUpdate();
                  }}
                                >
                                  ${ignoreToolIcon(20)}<span style="margin-left: 5px;"
                                    >${msg('Ignore')}</span
                                  >
                                </moss-mini-button>
                              `}
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
                     
                          <div style="margin-left:5px;"
                          >
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
                    </div> `
                : ''}
                    </div>
                  `,
          )}
              </div>
            `}`;
      default:
        return html``;
    }
  }
  render() {
    return html` <div class="column flex-1">
      ${this.renderInactiveTools()}
    </div>`;
  }
  static styles = [
    mossStyles,
    toolSettingsStyles,
    css`
      :host {
        display: flex;
      }

      .buttons {
        margin-right: 10px;
      }

      .activation-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(255, 255, 255, 0.4);
        backdrop-filter: blur(0.5px);
        z-index: 10;
        pointer-events: all;
        cursor: wait;
      }
    `,
  ];
}
