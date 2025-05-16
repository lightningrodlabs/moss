import { hashProperty, notify, notifyError } from '@holochain-open-dev/elements';
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
import { SlRadioGroup } from '@shoelace-style/shoelace';

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

  @state()
  valid = false;

  @state()
  assigning = false;

  checkValidity() {
    // Check whether confirmation checkbox is checked
    const confirmBox = this.shadowRoot?.getElementById('confirmation') as HTMLInputElement;
    if (!confirmBox.checked) {
      this.valid = false;
      return;
    }
    this.valid = true;
  }

  async addSteward(pubKey: AgentPubKey) {
    this.assigning = true;
    // Check whether with or without expiry
    const permissionTypeRadio = this.shadowRoot?.getElementById('permission-type-radio-group') as
      | SlRadioGroup
      | null
      | undefined;
    if (!permissionTypeRadio) {
      this.assigning = false;
      notifyError('Radio selection undefined,');
      throw new Error('Radio selection undefined.');
    }

    let expiry: number | undefined = undefined;
    const withExpiry = permissionTypeRadio.value === '1' ? true : false;

    if (withExpiry) {
      const datePicker = this.shadowRoot?.getElementById('date-picker') as
        | HTMLInputElement
        | null
        | undefined;

      if (!datePicker) {
        this.assigning = false;
        notifyError('Datepicker undefined,');
        throw new Error('Datepicker undefined');
      }

      if (!datePicker.value) {
        this.assigning = false;
        notifyError('Datepicker value undefined,');
        throw new Error('Datepicker value undefined');
      }

      const utcTimestamp = convertToUTCTimestamp(datePicker.value);
      expiry = utcTimestamp * 1000; // We need the timestamp in microseconds epoch time

      console.log('datepicker.value: ', datePicker.value);
      console.log('datepicker UTC timestamp', utcTimestamp);
      console.log('converted UTC iso string', new Date(utcTimestamp).toISOString());
      console.log('converted UTC toLocaleString', new Date(utcTimestamp).toLocaleString());
    }

    console.log('Creating permission...');

    try {
      await this._groupStore.groupClient.createStewardPermission({
        for_agent: pubKey,
        expiry,
      });
    } catch (e) {
      this.assigning = false;
      notifyError(`Failed to create permission: ${e}`);
      return;
    }
    // In case the reloading of the group store below fails we still want to show the notifications
    setTimeout(() => {
      notify('Steward role assigned.');
    });
    this.assignSteward = undefined;
    await this._groupStore.allAgentPermissionTypes.reload();
    this.requestUpdate();
    this.assigning = false;
  }

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
                id="permission-type-radio-group"
                label="${msg('Assign Steward role to ')}
                ${profile.type === 'unknown'
                  ? html`<i>${msg('unknown')}</i>`
                  : profile.profile.entry.nickname}"
                value="1"
              >
                <sl-radio style="margin-top: 20px;" value="1"
                  ><div class="column">
                    <span style="margin-right: 10px;">${msg('until:')}</span>
                    <vaadin-date-time-picker
                      id="date-picker"
                      .min="${formatDateToNearestHour(new Date(Date.now() + 1000 * 60 * 60))}"
                      .initialPosition=${formatDateToNearestHour(
                        new Date(Date.now() + 1000 * 60 * 60),
                      )}
                      value="${formatDateToNearestHour(new Date(Date.now() + 1000 * 60 * 60))}"
                      date-placeholder="${msg('Date')}"
                      time-placeholder="${msg('Time')}"
                    ></vaadin-date-time-picker>
                  </div>
                </sl-radio>

                <sl-radio style="margin-top: 10px; margin-bottom: 10px;" value="0"
                  >${msg('forever (no expiration date)')}</sl-radio
                >
              </sl-radio-group>

              <div class="row items-start" style="margin-top: 10px;">
                <input
                  id="confirmation"
                  type="checkbox"
                  style="width: 26px; height: 26px;"
                  @input=${() => {
                    console.log('GOt checkbox input');
                    this.checkValidity();
                  }}
                />
                <div class="warning" style="margin-left: 5px;">
                  ${msg('I understand that after assigning someone to the Steward role')}
                  <b>${msg('I cannot undo the action.')}</b>
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
                <button
                  class="moss-button"
                  style="width: 190px;"
                  ?disabled=${!this.valid}
                  @click=${() => {
                    this.addSteward(pubKey);
                  }}
                >
                  ${this.assigning
                    ? html`<div class="column center-content">
                        <div class="dot-carousel" style="margin: 5px 0;"></div>
                      </div>`
                    : html`${msg('Assign Steward Role')}`}
                </button>
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

/**
 * Formats a Date opbject to a string of the format "2020-06-12T12:00", rounded to the nearest hour
 */
function formatDateToNearestHour(date: Date) {
  // Create a new Date object to avoid modifying the original date
  const roundedDate = new Date(date);

  // // Get the minutes of the current time
  // const minutes = roundedDate.getMinutes();

  // // Round to the nearest hour
  // if (minutes >= 30) {
  //   roundedDate.setHours(roundedDate.getHours() + 1);
  // }

  // Round to next full hour
  roundedDate.setHours(roundedDate.getHours());

  // Set minutes and seconds to 0
  roundedDate.setMinutes(0);
  roundedDate.setSeconds(0);

  // Format the date to the desired string format
  const year = roundedDate.getFullYear();
  const month = String(roundedDate.getMonth() + 1).padStart(2, '0');
  const day = String(roundedDate.getDate()).padStart(2, '0');
  const hours = String(roundedDate.getHours()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:00`;
}

function convertToUTCTimestamp(dateString: string) {
  const date = new Date(dateString);
  const utcTimestamp = date.getTime();
  return utcTimestamp;
}
