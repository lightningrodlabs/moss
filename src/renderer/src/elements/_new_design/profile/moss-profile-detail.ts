import { consume } from '@lit/context';
import { AgentPubKey } from '@holochain/client';
import { html, LitElement } from 'lit';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { hashProperty } from '@holochain-open-dev/elements';

import '@holochain-open-dev/elements/dist/elements/display-error.js';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';

import '@shoelace-style/shoelace/dist/components/skeleton/skeleton.js';

import { profilesStoreContext } from '@holochain-open-dev/profiles';
import { ProfilesStore } from '@holochain-open-dev/profiles';
import { Profile } from '@holochain-open-dev/profiles';
import { EntryRecord } from '@holochain-open-dev/utils';
import { mossStyles } from '../../../shared-styles';

/**
 * @element profile-detail
 */
@localized()
@customElement('moss-profile-detail')
export class MossProfileDetail extends LitElement {
  /** Public properties */

  /**
   * REQUIRED. Public key identifying the agent for which the profile should be shown
   */
  @property(hashProperty('agent-pub-key'))
  agentPubKey!: AgentPubKey;

  /**
   * Profiles store for this element, not required if you embed this element inside a <profiles-context>
   */
  @consume({ context: profilesStoreContext, subscribe: true })
  @property()
  store!: ProfilesStore;

  @property({ type: Boolean, attribute: 'no-additional-fields' })
  noAdditionalFields = false;

  /** Private properties */

  /**
   * @internal
   */
  private _agentProfile = new StoreSubscriber(
    this,
    () => this.store.profiles.get(this.agentPubKey)!,
    () => [this.agentPubKey, this.store],
  );

  getAdditionalFields(profile: Profile): Record<string, string> {
    const fields: Record<string, string> = {};

    for (const [key, value] of Object.entries(profile.fields)) {
      if (key !== 'avatar') {
        fields[key] = value;
      }
    }

    return fields;
  }

  renderAdditionalField(fieldId: string, fieldValue: string) {
    return html`
      <div class="column" style="margin-top: 16px">
        <span style="margin-bottom: 8px; ">
          <strong>${fieldId.substring(0, 1).toUpperCase()}${fieldId.substring(1)}</strong></span
        >
        <span>${fieldValue}</span>
      </div>
    `;
  }

  renderProfile(profile: EntryRecord<Profile> | undefined | 'error') {
    if (!profile)
      return html`
        <div class="column items-center">
          <agent-avatar
            .agentPubKey=${this.agentPubKey}
            .size=${120}
            disable-tooltip
            disable-copy
            style="cursor: default;"
          ></agent-avatar>
          <span style="font-size: 28px; font-style: italic; margin-top: 12px;"
            >${msg('unknown')}</span
          >
        </div>
      `;

    if (profile === 'error')
      return html`
        <div class="column items-center">
          <agent-avatar
            .agentPubKey=${this.agentPubKey}
            .size=${120}
            disable-tooltip
            disable-copy
            style="cursor: default;"
          ></agent-avatar>
          <span style="font-size: 28px; font-style: italic; margin-top: 12px;"
            >${msg('ERROR')}</span
          >
        </div>
      `;

    return html`
      <div class="column items-center">
        <agent-avatar
          .agentPubKey=${this.agentPubKey}
          .size=${120}
          disable-tooltip
          disable-copy
          style="cursor: default;"
        ></agent-avatar>
        <span style="font-size: 28px; margin-top: 12px;">${profile.entry.nickname}</span>

        ${this.noAdditionalFields
          ? html``
          : Object.entries(this.getAdditionalFields(profile.entry))
              .filter(([, value]) => value !== '')
              .map(([key, value]) => this.renderAdditionalField(key, value))}
      </div>
    `;
  }

  render() {
    switch (this._agentProfile.value.status) {
      case 'pending':
        return html`
          <div class="column items-center">
            <sl-skeleton
              effect="pulse"
              style="height: 120px; width: 32px; border-radius: 50%;"
            ></sl-skeleton>
            <div>
              <sl-skeleton effect="pulse" style="width: 122px;"></sl-skeleton>
            </div>
          </div>
        `;
      case 'complete':
        return this.renderProfile(this._agentProfile.value.value);
      case 'error':
        console.error('Failed to get agent profile: ', this._agentProfile.value.error);
        return this.renderProfile('error');
    }
  }

  static styles = [mossStyles];
}
