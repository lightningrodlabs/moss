import { hashProperty } from '@holochain-open-dev/elements';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKey, DnaHash, encodeHashToBase64 } from '@holochain/client';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@holochain-open-dev/elements/dist/elements/holo-identicon.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@vaadin/date-time-picker';

import '../copy-hash';
import '../../../groups/elements/agent-permission';
import './agent-permission-button';

import { MossStore } from '../../../moss-store.js';
import { groupStoreContext } from '../../../groups/context.js';
import { GroupStore, MaybeProfile } from '../../../groups/group-store.js';
import { weStyles } from '../../../shared-styles.js';
import { mossStoreContext } from '../../../context.js';
import { warningCircle } from '../icons';

@localized()
@customElement('group-member-list')
export class GroupMemberList extends LitElement {
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

  @state()
  assignSteward: AgentPubKey | undefined;

  renderAvatar(pubKey: AgentPubKey, profile: MaybeProfile) {
    if (profile.type === 'unknown')
      return html`
        <div class="row" style="align-items: center; padding: 5px;">
          <div class="column" style="width: 32px; height: 32px; border-radius: 50%;">?</div>
          <span style="font-size: 16px; margin-left: 8px; font-style: italic;"
            >${msg('unknown')}</span
          >
        </div>
      `;

    return html`
      <div class="row" style="align-items: center; padding: 5px;">
        ${profile.profile.entry.fields.avatar
          ? html`<img
              src=${profile.profile.entry.fields.avatar}
              style="width: 32px; height: 32px; border-radius: 50%;"
            />`
          : html`
              <holo-identicon
                .disableCopy=${false}
                .disableTooltip=${true}
                .hash=${pubKey}
                .size=${32}
              >
              </holo-identicon>
            `}
        <div style="font-size: 16px; margin-left: 8px; width: 180px;">
          ${profile.profile.entry.nickname}
        </div>
      </div>
    `;
  }

  renderProfile(pubKey: AgentPubKey, profile: MaybeProfile, stewardable: boolean) {
    return html`
      <div class="column member-block">
        <div class="row items-center">
          ${this.renderAvatar(pubKey, profile)}
          <copy-hash
            .hash=${encodeHashToBase64(pubKey)}
            .tooltipText=${msg('click to copy public key')}
            shortened
          ></copy-hash>
          <span class="flex flex-1"></span>
          <agent-permission .agent=${pubKey}></agent-permission>
          <agent-permission-button
            .agent=${pubKey}
            @request-assign-steward=${() => {
              this.assignSteward = pubKey;
            }}
            ?noSteward=${!stewardable}
          ></agent-permission-button>
        </div>
        ${stewardable &&
        this.assignSteward &&
        encodeHashToBase64(this.assignSteward) === encodeHashToBase64(pubKey)
          ? html`<div class="column" style="padding: 10px;">
              <sl-radio-group
                label="${msg('assign Steward role to ')}
                ${profile.type === 'unknown'
                  ? html`<i>${msg('unknown')}</i>`
                  : profile.profile.entry.nickname}"
                value="1"
              >
                <sl-radio style="margin-top: 10px; margin-bottom: 10px;" value="1"
                  >${msg('forever (no expiration date)')}</sl-radio
                >
                <sl-radio style="margin-top: 20px;" value="0"
                  ><span style="margin-right: 10px;">${msg('until')}</span>
                  <vaadin-date-time-picker
                    .min="${new Date(Date.now() + 10 * 60).toISOString()}"
                    .initialPosition=${new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()}
                    value="${new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()}"
                    .step="${60 * 30}"
                    date-placeholder="${msg('Date')}"
                    time-placeholder="${msg('Time')}"
                  ></vaadin-date-time-picker
                ></sl-radio>
              </sl-radio-group>

              <div class="row warning items-center" style="margin-top: 20px;">
                <div class="column center-content">${warningCircle(30)}</div>
                <div style="margin-left: 10px;">
                  ${msg('After assigning someone to the Steward role')}
                  <b>${msg('you cannot undo the action.')}</b>
                  ${msg('A member will stay a Steward forever or until the specified date.')}
                </div>
              </div>
              <div class="row" style="margin-top: 10px;">
                <span class="flex flex-1"></span>
                <button
                  class="moss-button-secondary"
                  style="margin-right: 4px;"
                  @click=${() => {
                    this.assignSteward = undefined;
                  }}
                >
                  ${msg('Cancel')}
                </button>
                <button class="moss-button">${msg('Assign Steward Role')}</button>
              </div>
            </div>`
          : html``}
      </div>
    `;
  }

  renderMemberList(members: ReadonlyMap<Uint8Array, MaybeProfile>) {
    const headlessNodes = Array.from(members.entries()).filter(
      ([_pubKey, maybeProfile]) =>
        maybeProfile.type === 'profile' && !!maybeProfile.profile.entry.fields.wdockerNode,
    );
    let normalMembers = Array.from(members.entries()).filter(
      ([_pubKey, maybeProfile]) =>
        maybeProfile.type === 'unknown' || !maybeProfile.profile.entry.fields.wdockerNode,
    );

    return html` <div class="column">
      <div class="column">
        ${normalMembers.map(([pubkey, maybeProfile]) => {
          return this.renderProfile(pubkey, maybeProfile, true);
        })}
      </div>
      ${headlessNodes.length > 0
        ? html`
        <div style="margin-bottom: 5px; margin-top: 20px;">${msg('Headless Nodes')}</div>
          <div class="column">
            ${headlessNodes.map(([pubkey, maybeProfile]) =>
              this.renderProfile(pubkey, maybeProfile, false),
            )}
          </div>
        </div>`
        : html``}
    </div>`;
  }

  render() {
    switch (this._groupMemberWithProfiles.value?.status) {
      case 'pending':
        return html`<div class="row center-content" style="flex: 1;">
          <sl-spinner style="font-size: 2rem"></sl-spinner>
        </div>`;
      case 'complete':
        return this.renderMemberList(this._groupMemberWithProfiles.value.value);
      case 'error':
        return html`<display-error
          .headline=${msg('Error displaying the peers of the group')}
          .error=${this._groupMemberWithProfiles.value.error}
        ></display-error>`;
    }
  }

  static styles = [
    weStyles,
    css`
      .member-block {
        border-top: 1px solid var(--moss-grey-light);
        border-bottom: 1px solid var(--moss-grey-light);
        margin-bottom: -1px;
      }

      .warning {
        border-radius: 12px;
        background: var(--moss-light-green);
        padding: 10px 16px;
      }
    `,
  ];
}
