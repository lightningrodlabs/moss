import { customElement, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { notify } from '@holochain-open-dev/elements';

import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { mossStyles } from '../../../shared-styles.js';
import {
  setLocale,
  allLocales,
  LANGUAGE_NAMES,
  SupportedLocale,
} from '../../../locales/localization.js';

@localized()
@customElement('moss-language-settings')
export class MossLanguageSettings extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @state()
  selectedLocale: SupportedLocale = 'en';

  firstUpdated() {
    const storedLocale = this.mossStore.persistedStore.locale.value();
    if (storedLocale && allLocales.includes(storedLocale as SupportedLocale)) {
      this.selectedLocale = storedLocale as SupportedLocale;
    }
  }

  async handleLocaleChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    const newLocale = select.value as SupportedLocale;

    this.selectedLocale = newLocale;
    this.mossStore.persistedStore.locale.set(newLocale);

    try {
      await setLocale(newLocale);
      // Notify applets of locale change
      this.mossStore.broadcastLocaleChange(newLocale);
      notify(msg('Language changed.'));
    } catch (e) {
      console.error('Failed to set locale:', e);
      notify(msg('Failed to change language.'));
    }
  }

  render() {
    return html`
      <div class="column flex-1">
        <div style="margin-bottom: 24px; opacity: 0.8;">
          ${msg('Select your preferred language for the Moss interface.')}
        </div>

        <div class="row items-center">
          <label for="locale-select" style="margin-right: 16px; font-weight: 500;">
            ${msg('Language')}
          </label>
          <select
            id="locale-select"
            class="moss-select"
            .value=${this.selectedLocale}
            @change=${this.handleLocaleChange}
          >
            ${allLocales.map(
              (locale) => html`
                <option value=${locale} ?selected=${locale === this.selectedLocale}>
                  ${LANGUAGE_NAMES[locale]}
                </option>
              `,
            )}
          </select>
        </div>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: flex;
      }

      .moss-select {
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid var(--sl-color-neutral-300);
        background: var(--sl-color-neutral-0);
        font-size: 14px;
        min-width: 200px;
        cursor: pointer;
      }

      .moss-select:hover {
        border-color: var(--sl-color-neutral-400);
      }

      .moss-select:focus {
        outline: none;
        border-color: var(--sl-color-primary-500);
        box-shadow: 0 0 0 3px var(--sl-color-primary-100);
      }
    `,
  ];
}
