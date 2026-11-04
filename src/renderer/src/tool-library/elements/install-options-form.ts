import { css, html, LitElement, PropertyValues, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { AgentPubKey, encodeHashToBase64 } from '@holochain/client';
import type { LocalizedText, ToolInstallOption } from '@theweave/api';
import type { RoleProperties } from '@theweave/moss-types';

import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@holochain-open-dev/profiles/dist/elements/agent-avatar.js';
import type SlInput from '@shoelace-style/shoelace/dist/components/input/input.js';
import type SlSelect from '@shoelace-style/shoelace/dist/components/select/select.js';
import type SlSwitch from '@shoelace-style/shoelace/dist/components/switch/switch.js';

import { groupStoreContext } from '../../groups/context.js';
import { GroupStore, MaybeProfile } from '../../groups/group-store.js';
import { mossStyles } from '../../shared-styles.js';
import {
  choiceAtIndex,
  choicesAtIndices,
  indexOfChoice,
  indicesOfChoices,
  initialValues,
  InstallOptionValue,
  InstallOptionValues,
  optionKey,
  validateValue,
} from '../install-options.js';
import { valueProblemMessage } from '../install-options-messages.js';
import { activeOptionKeys, withoutInactive } from '../install-option-conditions.js';
import { localizedText } from '../localized-text.js';
import { getLocale } from '../../locales/localization.js';

type OptionControl = SlInput | SlSelect | SlSwitch;

/**
 * The fields for a Tool's declared install options. Owns the chosen values;
 * the install dialog asks for them at submit and checks them through
 * `reportValidity()`, since controls in this shadow root are not part of
 * the dialog's own form.
 */
@localized()
@customElement('install-options-form')
export class InstallOptionsForm extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @property({ attribute: false })
  options: ToolInstallOption[] = [];

  @property({ attribute: false })
  manifestDefaults: RoleProperties = {};

  @state()
  private _values: InstallOptionValues = {};

  /**
   * What the text and number inputs were seeded with. They are bound to
   * this, not to `_values`, so a keystroke never re-sets the control's
   * value and wipes partially typed text such as `1.` or `-`.
   */
  private _seeds: InstallOptionValues = {};

  /** Options that currently apply; the others are not rendered. */
  private _active = new Set<string>();

  private _members = new StoreSubscriber(
    this,
    () => this.groupStore?.allProfiles,
    () => [this.groupStore],
  );

  willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('options') || changed.has('manifestDefaults')) {
      this._values = initialValues(this.options, this.manifestDefaults);
      this._seeds = this._values;
      this._active = new Set();
    }
    const active = activeOptionKeys(this.options, this._values);
    // A shown-again input is a new element, so seed it with what the
    // installer last entered rather than the original seed.
    const reshown = [...active].filter((key) => !this._active.has(key));
    if (reshown.length > 0) {
      this._seeds = { ...this._seeds };
      for (const key of reshown) this._seeds[key] = this._values[key];
    }
    this._active = active;
  }

  /** The chosen values, with options that do not apply left empty. */
  get currentValues(): InstallOptionValues {
    return withoutInactive(this.options, this._values);
  }

  reportValidity(): boolean {
    let allValid = true;
    for (const option of this.options) {
      if (!this._active.has(optionKey(option))) continue;
      const problem = validateValue(option, this._values[optionKey(option)]);
      const control = this.controlFor(option);
      control?.setCustomValidity(problem ? valueProblemMessage(problem, option.kind) : '');
      if (problem) {
        allValid = false;
        control?.reportValidity();
      }
    }
    return allValid;
  }

  private controlFor(option: ToolInstallOption): OptionControl | null {
    return this.shadowRoot!.querySelector<OptionControl>(
      `[data-option="${CSS.escape(optionKey(option))}"]`,
    );
  }

  private text(text: LocalizedText | undefined): string {
    return localizedText(text, getLocale());
  }

  private setValue(option: ToolInstallOption, value: InstallOptionValue | undefined): void {
    this._values = { ...this._values, [optionKey(option)]: value };
    this.controlFor(option)?.setCustomValidity('');
  }

  private renderBoolean(option: Extract<ToolInstallOption, { kind: 'boolean' }>): TemplateResult {
    return html`
      <sl-switch
        data-option=${optionKey(option)}
        ?checked=${this._values[optionKey(option)] === true}
        help-text=${this.text(option.description)}
        @sl-change=${(e: Event) => this.setValue(option, (e.target as SlSwitch).checked)}
        >${this.text(option.label)}</sl-switch
      >
    `;
  }

  private renderChoice(
    option: Extract<ToolInstallOption, { kind: 'stringChoice' | 'numberChoice' }>,
  ): TemplateResult {
    return html`
      <sl-select
        data-option=${optionKey(option)}
        class="moss-input"
        .label=${this.text(option.label)}
        help-text=${this.text(option.description)}
        .value=${indexOfChoice(option, this._values[optionKey(option)])}
        ?required=${option.required}
        ?clearable=${!option.required}
        hoist
        @sl-change=${(e: Event) =>
          this.setValue(option, choiceAtIndex(option, (e.target as SlSelect).value as string))}
      >
        ${option.choices.map(
          (choice, index) =>
            html`<sl-option value=${String(index)}>${this.text(choice.label)}</sl-option>`,
        )}
      </sl-select>
    `;
  }

  private renderChoiceList(
    option: Extract<ToolInstallOption, { kind: 'stringChoiceList' }>,
  ): TemplateResult {
    return html`
      <sl-select
        data-option=${optionKey(option)}
        class="moss-input"
        .label=${this.text(option.label)}
        help-text=${this.text(option.description)}
        .value=${indicesOfChoices(option, this._values[optionKey(option)])}
        ?required=${option.required}
        multiple
        clearable
        hoist
        @sl-change=${(e: Event) =>
          this.setValue(option, choicesAtIndices(option, (e.target as SlSelect).value as string[]))}
      >
        ${option.choices.map(
          (choice, index) =>
            html`<sl-option value=${String(index)}>${this.text(choice.label)}</sl-option>`,
        )}
      </sl-select>
    `;
  }

  private renderString(option: Extract<ToolInstallOption, { kind: 'string' }>): TemplateResult {
    const seed = this._seeds[optionKey(option)];
    return html`
      <sl-input
        data-option=${optionKey(option)}
        class="moss-input"
        .label=${this.text(option.label)}
        help-text=${this.text(option.description)}
        .value=${typeof seed === 'string' ? seed : ''}
        minlength=${option.minLength ?? 0}
        maxlength=${option.maxLength}
        ?required=${option.required}
        @sl-input=${(e: Event) => {
          const text = (e.target as SlInput).value;
          this.setValue(option, text === '' ? undefined : text);
        }}
      ></sl-input>
    `;
  }

  private renderNumber(option: Extract<ToolInstallOption, { kind: 'number' }>): TemplateResult {
    const seed = this._seeds[optionKey(option)];
    return html`
      <sl-input
        data-option=${optionKey(option)}
        class="moss-input"
        type="number"
        .label=${this.text(option.label)}
        help-text=${this.text(option.description)}
        .value=${typeof seed === 'number' ? String(seed) : ''}
        min=${option.min}
        max=${option.max}
        step=${option.integer ? 1 : 'any'}
        ?required=${option.required}
        @sl-input=${(e: Event) => {
          const n = (e.target as SlInput).valueAsNumber;
          this.setValue(option, Number.isNaN(n) ? undefined : n);
        }}
      ></sl-input>
    `;
  }

  private renderAgentList(
    option: Extract<ToolInstallOption, { kind: 'agentList' }>,
  ): TemplateResult {
    const current = this._values[optionKey(option)];
    const members: Array<[AgentPubKey, MaybeProfile]> =
      this._members.value?.status === 'complete'
        ? Array.from(this._members.value.value.entries())
        : [];
    return html`
      <sl-select
        data-option=${optionKey(option)}
        class="moss-input"
        .label=${this.text(option.label)}
        help-text=${this.text(option.description)}
        .value=${Array.isArray(current) ? current : []}
        placeholder=${msg('Select members')}
        ?required=${option.required}
        multiple
        clearable
        hoist
        @sl-change=${(e: Event) => this.setValue(option, (e.target as SlSelect).value as string[])}
      >
        ${members.map(([agentPubKey, maybeProfile]) =>
          maybeProfile.type === 'profile'
            ? html`<sl-option value=${encodeHashToBase64(agentPubKey)}>
                <agent-avatar
                  slot="prefix"
                  .size=${20}
                  .agentPubKey=${agentPubKey}
                  disable-tooltip
                ></agent-avatar>
                ${maybeProfile.profile.entry.nickname}
              </sl-option>`
            : html``,
        )}
      </sl-select>
    `;
  }

  private renderOption(option: ToolInstallOption): TemplateResult {
    switch (option.kind) {
      case 'boolean':
        return this.renderBoolean(option);
      case 'stringChoice':
      case 'numberChoice':
        return this.renderChoice(option);
      case 'stringChoiceList':
        return this.renderChoiceList(option);
      case 'string':
        return this.renderString(option);
      case 'number':
        return this.renderNumber(option);
      case 'agentList':
        return this.renderAgentList(option);
    }
  }

  render() {
    return html`
      <div class="column options">
        ${this.options
          .filter((option) => this._active.has(optionKey(option)))
          .map((option) => html`<div class="option">${this.renderOption(option)}</div>`)}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      .options {
        gap: 12px;
        margin-bottom: 16px;
      }
      .option {
        display: flex;
        flex-direction: column;
      }
    `,
  ];
}
