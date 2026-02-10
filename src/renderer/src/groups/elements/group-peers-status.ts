import { hashProperty } from '@holochain-open-dev/elements';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKey, DnaHash, encodeHashToBase64 } from '@holochain/client';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import { groupStoreContext } from '../context.js';
import { mossStyles } from '../../shared-styles.js';
import { GroupStore, IDLE_THRESHOLD, MaybeProfile, OFFLINE_THRESHOLD } from '../group-store.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';

import '../../elements/reusable/profile-detail.js';
import { localTimeFromUtcOffset } from '../../utils.js';

export type AgentAndTzOffset = {
  agent: AgentPubKey;
  tzUtcOffset?: number;
};

@localized()
@customElement('group-peers-status')
export class GroupPeersStatus extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  _mossStore!: MossStore;

  @consume({ context: groupStoreContext, subscribe: true })
  _groupStore!: GroupStore;

  @property(hashProperty('group-dna-hash'))
  groupDnaHash!: DnaHash;

  _groupMemberWithProfiles = new StoreSubscriber(
    this,
    () => this._groupStore?.allProfiles,
    () => [this._groupStore, this.groupDnaHash],
  );

  _peerStatuses = new StoreSubscriber(
    this,
    () => this._groupStore.peerStatuses(),
    () => [this._groupStore],
  );

  renderAgentInfo(agentPubKey, isOnline, tzUtcOffset?, isMe?) {
    return html` <profile-detail-moss
      style="color: black; ${isOnline ? '' : 'opacity: 0.5'}"
      no-additional-fields
      .agentPubKey=${agentPubKey}
      >${tzUtcOffset
        ? html`<sl-tooltip slot="extra" .content=${msg('Local Time')}
            ><div style="opacity: 0.5;">${localTimeFromUtcOffset(tzUtcOffset)}</div></sl-tooltip
          >`
        : ''}
      ${isMe ? html`<div slot="action">&nbsp;(${msg('me')})</div>` : ''}
    </profile-detail-moss>`;
  }

  renderPeersStatus(members: ReadonlyMap<Uint8Array, MaybeProfile>) {
    const headlessNodes = Array.from(members.entries()).filter(
      ([_pubKey, maybeProfile]) =>
        maybeProfile.type === 'profile' && !!maybeProfile.profile.entry.fields.wdockerNode,
    );
    let normalMembers = Array.from(members.entries()).filter(
      ([_pubKey, maybeProfile]) =>
        maybeProfile.type === 'unknown' || !maybeProfile.profile.entry.fields.wdockerNode,
    );
    if (!this._peerStatuses.value) return html``;
    const now = Date.now();
    const myPubKey = this._groupStore.groupClient.myPubKey;
    const myStatus =
      now - this._mossStore.myLatestActivity > IDLE_THRESHOLD ? 'inactive' : 'online';
    normalMembers = normalMembers.filter(
      ([agent, _]) => encodeHashToBase64(agent) !== encodeHashToBase64(myPubKey),
    );

    const headlessAgents = headlessNodes.map(([agent, _]) => {
      const statusInfo = this._peerStatuses.value![encodeHashToBase64(agent)];
      const online = !!statusInfo && now - statusInfo.lastSeen < OFFLINE_THRESHOLD;
      return {
        agent,
        tzUtcOffset: online ? statusInfo.tzUtcOffset : undefined,
        status: online ? statusInfo.status : undefined,
      };
    });

    const onlineAgents = normalMembers
      .filter(([agent, _]) => {
        const statusInfo = this._peerStatuses.value![encodeHashToBase64(agent)];
        return !!statusInfo && now - statusInfo.lastSeen < OFFLINE_THRESHOLD;
      })
      .map(([agent, _]) => {
        const statusInfo = this._peerStatuses.value![encodeHashToBase64(agent)];
        return {
          agent,
          tzUtcOffset: statusInfo.tzUtcOffset,
          status: statusInfo.status,
        };
      });

    const offlineAgents: AgentAndTzOffset[] = normalMembers
      .filter(([agent, _]) => {
        const statusInfo = this._peerStatuses.value![encodeHashToBase64(agent)];
        return !statusInfo || now - statusInfo.lastSeen > OFFLINE_THRESHOLD;
      })
      .map(([agent, _]) => {
        return {
          agent,
          tzUtcOffset: undefined,
        };
      });

    return html`
      <div class="column agents-list">
        <div class="status-text">${msg('Online')}</div>
        <div class="column">
          <div
            class="row profile"
            style="position: relative;"
            tabindex="0"
            @click=${() => {
              this.dispatchEvent(
                new CustomEvent('profile-selected', {
                  detail: {
                    agent: myPubKey,
                    tzUtcOffset: this._mossStore.tzUtcOffset(),
                  },
                  bubbles: true,
                  composed: true,
                }),
              );
            }}
            @keypress=${(e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                this.dispatchEvent(
                  new CustomEvent('profile-selected', {
                    detail: {
                      agent: myPubKey,
                      tzUtcOffset: this._mossStore.tzUtcOffset(),
                    },
                    bubbles: true,
                    composed: true,
                  }),
                );
              }
            }}
          >
            ${this.renderAgentInfo(myPubKey, true, undefined, true)}
            <div class="status-indicator ${myStatus === 'inactive' ? 'inactive' : ''}"></div>
            <div
              class="inactive-indicator"
              style="${myStatus === 'inactive' ? '' : 'display: none;'}"
            ></div>
          </div>

          ${onlineAgents.map((agentInfo) => {
            return html`
              <div
                class="row profile"
                style="position: relative;"
                tabindex="0"
                @click=${() => {
                  this.dispatchEvent(
                    new CustomEvent('profile-selected', {
                      detail: agentInfo,
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
                @keypress=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    this.dispatchEvent(
                      new CustomEvent('profile-selected', {
                        detail: agentInfo,
                        bubbles: true,
                        composed: true,
                      }),
                    );
                  }
                }}
              >
                ${this.renderAgentInfo(agentInfo.agent, true, agentInfo.tzUtcOffset)}
                <div
                  class="status-indicator ${agentInfo.status === 'inactive' ? 'inactive' : ''}"
                ></div>
                <div
                  class="inactive-indicator"
                  style="${agentInfo.status === 'inactive' ? '' : 'display: none;'}"
                ></div>
              </div>
            `;
          })}
        </div>
        ${offlineAgents.length > 0
          ? html` <div style="margin-top:24px;" class="status-text">${msg('Offline')}</div>
              <div class="column">
                ${offlineAgents.map(
                  (agentInfo) => html`
                    <div
                      class="row profile"
                      style="position: relative;"
                      @click=${() => {
                        this.dispatchEvent(
                          new CustomEvent('profile-selected', {
                            detail: agentInfo,
                            bubbles: true,
                            composed: true,
                          }),
                        );
                      }}
                      @keypress=${(e: KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          this.dispatchEvent(
                            new CustomEvent('profile-selected', {
                              detail: agentInfo,
                              bubbles: true,
                              composed: true,
                            }),
                          );
                        }
                      }}
                    >
                      ${this.renderAgentInfo(agentInfo.agent, false, agentInfo.tzUtcOffset)}
                    </div>
                  `,
                )}
              </div>`
          : html``}
        ${headlessAgents.length > 0
          ? html` <div style="margin-bottom: 5px; margin-top: 20px;">${msg('Headless Nodes')}</div>
              <div class="column">
                ${headlessAgents.map(
                  (agentInfo) => html`
                    <div
                      class="row profile"
                      style="position: relative;"
                      @click=${() => {
                        this.dispatchEvent(
                          new CustomEvent('profile-selected', {
                            detail: agentInfo,
                            bubbles: true,
                            composed: true,
                          }),
                        );
                      }}
                      @keypress=${(e: KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          this.dispatchEvent(
                            new CustomEvent('profile-selected', {
                              detail: agentInfo,
                              bubbles: true,
                              composed: true,
                            }),
                          );
                        }
                      }}
                    >
                      ${this.renderAgentInfo(
                        agentInfo.agent,
                        agentInfo.status,
                        agentInfo.tzUtcOffset,
                      )}
                      ${agentInfo.status ? html`<div class="status-indicator"></div>` : html``}
                    </div>
                  `,
                )}
              </div>`
          : html``}
      </div>
    `;
  }

  render() {
    switch (this._groupMemberWithProfiles.value?.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1;">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        return this.renderPeersStatus(this._groupMemberWithProfiles.value.value);
      case 'error':
        return html`<display-error
          .headline=${msg('Error displaying the peers of the group')}
          .error=${this._groupMemberWithProfiles.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    mossStyles,
    css`
      profile-detail {
        margin: 5px;
        color: black;
      }

      .agents-list {
        color: black;
        font-size: 1.1rem;
      }

      .agents-list span {
        color: black;
      }

      .profile {
        border-radius: 8px;
      }

      .profile:hover {
        background: #eff7ea;
        cursor: pointer;
      }

      .status-indicator {
        position: absolute;
        top: 25px;
        left: 25px;
        height: 11px;
        width: 11px;
        border: 2px solid var(--moss-fishy-green);
        border-radius: 50%;
        background: #44d944;
      }

      .inactive {
        background: #fcd200;
      }

      .inactive-indicator {
        position: absolute;
        top: 26px;
        left: 26px;
        height: 9px;
        width: 9px;
        border-radius: 50%;
        background: var(--moss-fishy-green);
      }

      .status-text {
        margin-right: auto;
        margin-left: auto;
        margin-top: 8px;
        opacity: 0.6;
        font-size: 12px;
        font-style: normal;
        font-weight: 500;
      }
    `,
  ];
}
