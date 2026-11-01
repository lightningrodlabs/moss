import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { notify, wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiTranslate } from '@mdi/js';

import '@shoelace-style/shoelace/dist/components/dropdown/dropdown.js';
import '@shoelace-style/shoelace/dist/components/menu/menu.js';
import '@shoelace-style/shoelace/dist/components/menu-item/menu-item.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

import {
  allLocales,
  getLocale,
  isSupportedLocale,
  LANGUAGE_NAMES,
  setLocale,
  SupportedLocale,
} from '../locales/localization.js';
import { PersistedStore } from '../persisted-store.js';
import { mossStyles } from '../shared-styles.js';

/**
 * Picks the interface language. The button shows a neutral translate icon and the
 * current language's own name, so no language is tied to a country's flag.
 *
 * It reads and writes the stored preference directly rather than through the
 * Moss store, because the first thing someone sees on a first launch is the
 * setup page, and a person who cannot read the interface should not have to
 * wait for the rest of the app to be ready before changing it.
 */
@localized()
@customElement('language-picker')
export class LanguagePicker extends LitElement {
  private persistedStore = new PersistedStore();

  @state()
  private locale: SupportedLocale = 'en';

  firstUpdated(): void {
    // The locale in force, not the stored preference. On a first launch there
    // is no stored preference and index.html has already fallen back to the
    // system language, so reading the preference would show the name of a
    // language the interface is not actually in.
    const active = getLocale();
    if (isSupportedLocale(active)) this.locale = active;
  }

  private async choose(locale: SupportedLocale): Promise<void> {
    this.locale = locale;
    this.persistedStore.locale.set(locale);
    try {
      await setLocale(locale);
    } catch (e) {
      console.error('Failed to set locale:', e);
      notify(msg('Failed to change language.'));
      return;
    }
    this.dispatchEvent(
      new CustomEvent('locale-changed', { detail: locale, bubbles: true, composed: true }),
    );
  }

  render() {
    return html`
      <sl-dropdown placement="top-start" hoist>
        <button slot="trigger" class="language-button" aria-label=${msg('Language')}>
          <sl-icon .src=${wrapPathInSvg(mdiTranslate)}></sl-icon>
          <span>${LANGUAGE_NAMES[this.locale]}</span>
        </button>
        <sl-menu
          @sl-select=${(e: CustomEvent) => this.choose(e.detail.item.value as SupportedLocale)}
        >
          ${allLocales.map(
            (locale) => html`
              <sl-menu-item value=${locale} type="checkbox" ?checked=${locale === this.locale}>
                <span lang=${locale}>${LANGUAGE_NAMES[locale]}</span>
              </sl-menu-item>
            `,
          )}
        </sl-menu>
      </sl-dropdown>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: inline-flex;
      }
      .language-button {
        all: unset;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 6px 8px;
        border-radius: 8px;
        opacity: 0.85;
      }
      .language-button sl-icon {
        font-size: 18px;
      }
      .language-button:focus-visible {
        outline: 2px solid var(--moss-purple);
      }
      .language-button:hover {
        opacity: 1;
        background: rgba(0, 0, 0, 0.06);
      }
    `,
  ];
}
