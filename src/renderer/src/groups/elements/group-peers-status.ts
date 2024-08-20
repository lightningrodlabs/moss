import { hashProperty } from '@holochain-open-dev/elements';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKey, DnaHash, encodeHashToBase64 } from '@holochain/client';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import '@holochain-open-dev/profiles/dist/elements/profile-detail.js';
import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import { groupStoreContext } from '../context.js';
import { weStyles } from '../../shared-styles.js';
import { GroupStore, IDLE_THRESHOLD, OFFLINE_THRESHOLD } from '../group-store.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';

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

  _group = new StoreSubscriber(
    this,
    () => this._groupStore?.members,
    () => [this._groupStore, this.groupDnaHash],
  );

  _peerStatuses = new StoreSubscriber(
    this,
    () => this._groupStore.peerStatuses(),
    () => [this._groupStore],
  );

  renderPeersStatus(members: AgentPubKey[]) {
    if (!this._peerStatuses.value) return html``;
    const now = Date.now();
    const myPubKey = this._groupStore.groupClient.myPubKey;
    const myStatus =
      now - this._mossStore.myLatestActivity > IDLE_THRESHOLD ? 'inactive' : 'online';
    members = members.filter((agent) => encodeHashToBase64(agent) !== encodeHashToBase64(myPubKey));
    const onlineAgents = members
      .filter((agent) => {
        const agentStatus = this._peerStatuses.value![encodeHashToBase64(agent)];
        return !!agentStatus && now - agentStatus.lastSeen < OFFLINE_THRESHOLD;
      })
      .map((agent) => {
        const statusInfo = this._peerStatuses.value![encodeHashToBase64(agent)];
        return {
          agent,
          tzUtcOffset: statusInfo.tzUtcOffset,
          status: statusInfo.status,
        };
      });

    const offlineAgents: AgentAndTzOffset[] = members
      .filter((agent) => {
        const agentStatus = this._peerStatuses.value![encodeHashToBase64(agent)];
        return !agentStatus || now - agentStatus.lastSeen > OFFLINE_THRESHOLD;
      })
      .map((agent) => {
        return {
          agent,
          tzUtcOffset: undefined,
        };
      });

    return html`
      <div class="column agents-list">
        <div style="margin-bottom: 5px;">${msg('Online')}</div>
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
            <profile-detail .agentPubKey=${myPubKey}></profile-detail>
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
                <profile-detail .agentPubKey=${agentInfo.agent}></profile-detail>
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
          ? html` <div style="margin-bottom: 5px; margin-top: 20px;">${msg('Offline')}</div>
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
                      <profile-detail
                        style="opacity: 0.5;"
                        .agentPubKey=${agentInfo.agent}
                      ></profile-detail>
                    </div>
                  `,
                )}
              </div>`
          : html``}
      </div>
    `;
  }

  render() {
    switch (this._group.value?.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1;">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        return this.renderPeersStatus(this._group.value.value);
      case 'error':
        return html`<display-error
          .headline=${msg('Error displaying the peers of the group')}
          .error=${this._group.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    weStyles,
    css`
      profile-detail {
        margin: 5px;
        color: #fff;
      }

      .agents-list {
        color: #fff;
        font-size: 1.1rem;
      }

      .agents-list span {
        color: white;
      }

      .profile {
        border-radius: 5px;
      }

      .profile:hover {
        background: #ffffff1f;
        cursor: pointer;
      }

      .status-indicator {
        position: absolute;
        top: 25px;
        left: 25px;
        height: 11px;
        width: 11px;
        border: 2px solid #1e3b25;
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
        background: #1e3b25;
      }
    `,
  ];
}
