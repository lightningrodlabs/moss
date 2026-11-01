import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/divider/divider.js';

import '../ui/language-picker.js';
import { mossStyles } from '../shared-styles.js';
import { getLocale } from '../locales/localization.js';
import { LegacyImportOffer, LegacyProfileInfo } from '../electron-api.js';

/**
 * First-launch card offering to import the identity and groups of an existing Moss
 * profile. Fires `import-profile` (detail: the chosen LegacyProfileInfo) or `start-fresh`.
 */
@localized()
@customElement('legacy-import-card')
export class LegacyImportCard extends LitElement {
  @property({ attribute: false })
  offer!: LegacyImportOffer;

  @state()
  private _selectedIdx = 0;

  @state()
  private _importing = false;

  private get _selected(): LegacyProfileInfo | undefined {
    return this.offer.profiles[this._selectedIdx];
  }

  private _versionLabel(p: LegacyProfileInfo): string {
    return p.appName.replace('org.lightningrodlabs.moss-', 'Moss ');
  }

  private _lastUsed(p: LegacyProfileInfo): string {
    return new Date(p.lastUsed).toLocaleDateString(getLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  private _import() {
    const profile = this._selected;
    if (!profile) return;
    this._importing = true;
    this.dispatchEvent(
      new CustomEvent<LegacyProfileInfo>('import-profile', {
        detail: profile,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _startFresh() {
    this.dispatchEvent(new CustomEvent('start-fresh', { bubbles: true, composed: true }));
  }

  private _renderOptions() {
    if (this.offer.mode === 'upgrade') {
      return this.offer.profiles.map(
        (p, i) => html`<sl-option value=${i}>Moss ${p.versionString}</sl-option>`,
      );
    }
    // Fork offers every profile, so group them under their Moss version.
    return this.offer.profiles.map((p, i) => {
      const prev = this.offer.profiles[i - 1];
      const header =
        !prev || prev.appName !== p.appName
          ? html`${i > 0 ? html`<sl-divider></sl-divider>` : nothing}
              <small>${this._versionLabel(p)}</small>`
          : nothing;
      return html`${header}
        <sl-option value=${i}>${p.profileName} (${p.versionString})</sl-option>`;
    });
  }

  render() {
    const upgrade = this.offer.mode === 'upgrade';
    const selected = this._selected;
    return html`
      <div class="moss-card column card">
        <div class="dialog-title title">
          ${upgrade
            ? msg('Import from an earlier Moss version?')
            : msg('Import a copy of a profile?')}
        </div>
        <p class="intro">
          ${upgrade
            ? msg(
                'This version of Moss cannot connect to people who still use an earlier version. You can bring your identity and groups over from an earlier version, or start fresh.',
              )
            : msg(
                'You can copy the identity and groups of an existing profile. The copied groups and Tools join new networks, separate from the originals.',
              )}
        </p>

        <sl-select
          label=${upgrade ? msg('Version to import from') : msg('Profile to copy')}
          value=${this._selectedIdx}
          hoist
          @sl-change=${(e: Event) => {
            this._selectedIdx = Number((e.target as HTMLSelectElement).value);
          }}
        >
          ${this._renderOptions()}
        </sl-select>
        ${selected
          ? html`<div class="details">
              ${msg(str`Profile "${selected.profileName}", last used ${this._lastUsed(selected)}`)}
            </div>`
          : nothing}

        <div class="section-title">${msg('What gets imported')}</div>
        <ul>
          <li>${msg('Your identity, so other members recognize you.')}</li>
          <li>${msg('Your groups, with their names, icons and your profile in each.')}</li>
          <li>
            ${msg(
              'The Tools in each group, if they are available for this version of Moss. After the import, Moss lists any Tool that it could not install.',
            )}
          </li>
        </ul>
        <div class="section-title">${msg('What does not get imported')}</div>
        <ul>
          <li>
            ${msg(
              'The content inside Tools, for example posts, files and boards. The Tools start empty. If a Tool can export its data, export it in the earlier version and import it here.',
            )}
          </li>
          <li>
            ${msg(
              'The Tools of a stewarded group that you did not create. They appear when the person who created the group imports it into this version of Moss.',
            )}
          </li>
        </ul>
        ${upgrade
          ? html`<p class="hint">
              ${msg(
                'Members who still use an earlier version cannot see you here until they also move to this version.',
              )}
            </p>`
          : nothing}
        <p class="hint">
          ${msg('Importing copies the data. The earlier profile does not change.')}
        </p>

        <div class="row buttons">
          <language-picker></language-picker>
          <span class="flex-1"></span>
          <button
            class="moss-button-secondary"
            ?disabled=${this._importing}
            @click=${() => this._startFresh()}
          >
            ${msg('Start fresh')}
          </button>
          <button
            class="moss-button"
            ?disabled=${!selected || this._importing}
            @click=${() => this._import()}
          >
            ${msg('Import')}
          </button>
        </div>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      .card {
        width: 720px;
        max-width: calc(100vw - 32px);
        box-sizing: border-box;
        padding: 40px 48px;
      }
      .title {
        text-align: center;
        margin-bottom: 12px;
      }
      .intro {
        text-align: center;
        color: var(--moss-hint-green);
        margin: 0 0 24px 0;
      }
      .details {
        font-size: 0.85em;
        color: var(--moss-hint-green);
        margin-top: 6px;
      }
      .section-title {
        font-weight: 600;
        margin-top: 20px;
      }
      ul {
        margin: 6px 0 0 0;
        padding-left: 20px;
      }
      li {
        margin-bottom: 4px;
      }
      .hint {
        font-size: 0.85em;
        color: var(--moss-hint-green);
        margin: 12px 0 0 0;
      }
      .buttons {
        align-items: center;
        gap: 12px;
        margin-top: 28px;
      }
    `,
  ];
}
