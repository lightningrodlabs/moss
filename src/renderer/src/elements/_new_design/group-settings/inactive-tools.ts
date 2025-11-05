import { Applet, AppletAgent } from '@theweave/group-client/dist/types.js';
import { DistributionInfo, TDistributionInfo, ToolInfoAndVersions } from '@theweave/moss-types';
import { AppletHash, AppletId } from '@theweave/api';
import { pipe, StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { customElement, property, state } from 'lit/decorators.js';
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
      this._recentlyJoined.push(encodeHashToBase64(appletHash));
      //this._showIgnoredApplets = false;
    } catch (e) {
      notifyError(`Failed to activate tool (See console for details).`);
      console.error(e);
    }
    this._joiningNewApplet = undefined;
  }

  _unjoinedApplets = new StoreSubscriber(
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
                console.warn('@group-home @unjoined-applets: Failed to get appletEntry: ', e);
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
  _recentlyJoined: Array<AppletId> = [];
  @state()
  _joiningNewApplet: string | undefined;
  @state()
  expandedApplets = {};
  toggleExpandedApplets(hash) {
    this.expandedApplets[hash] = !this.expandedApplets[hash];
    this.requestUpdate();
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
        const timeAgo = new TimeAgo('en-US');
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
    `,
  ];
}
