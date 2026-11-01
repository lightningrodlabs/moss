import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

import '../ui/language-picker.js';
import { mossStyles } from '../shared-styles.js';
import { GroupImportResult, LegacyProfileCopyResult } from '../electron-api.js';

type GroupResult = GroupImportResult[number];

/**
 * Shown on the import progress screen once a first-launch import is done, listing
 * what was carried over from the earlier profile and what was not. Fires
 * `continue` when dismissed.
 */
@localized()
@customElement('legacy-import-summary')
export class LegacyImportSummary extends LitElement {
  @property({ attribute: false })
  copied: LegacyProfileCopyResult = { identity: false, groups: false };

  @property({ attribute: false })
  results: GroupImportResult = [];

  private _statusText(r: GroupResult): string {
    switch (r.status) {
      case 'created':
        return msg('Imported.');
      case 'joined':
        return msg('Joined.');
      case 'joined-no-profile':
        return msg(
          'Joined. The group name and icon appear when another member of the group is online.',
        );
      case 'imported-disabled':
        return msg('Imported and left disabled, as it was in the earlier version.');
      case 'already-installed':
        return msg('Already in this profile.');
      case 'error':
        return msg(str`Could not be imported: ${r.error ?? ''}`);
    }
  }

  private _renderGroup(r: GroupResult) {
    const installed = r.installedTools ?? [];
    const notAvailable = (r.skippedTools ?? []).filter((t) => t.reason === 'not-available');
    const failed = (r.skippedTools ?? []).filter((t) => t.reason === 'failed');
    const hadTools =
      installed.length + (r.skippedTools?.length ?? 0) + (r.toolsAwaitingProgenitor ?? 0) > 0;
    return html`
      <div class="group">
        <div class="group-name">${r.groupName ?? msg('Unknown group')}</div>
        <ul>
          <li>${this._statusText(r)}</li>
          ${installed.length
            ? html`<li>${msg('Tools installed:')} ${installed.join(', ')}</li>`
            : nothing}
          ${notAvailable.length
            ? html`<li class="problem">
                ${msg('Not available for this version of Moss:')}
                ${notAvailable.map((t) => t.name).join(', ')}
              </li>`
            : nothing}
          ${failed.length
            ? html`<li class="problem">
                ${msg('Could not be installed:')}
                ${failed.map(
                  (t, i) =>
                    html`${i > 0 ? ', ' : ''}<sl-tooltip content=${t.error ?? ''}
                        ><span class="failed">${t.name}</span></sl-tooltip
                      >`,
                )}
              </li>`
            : nothing}
          ${r.toolsAwaitingProgenitor
            ? html`<li class="problem">
                ${msg(
                  'You did not create this group, so Moss did not install its Tools. They appear when the person who created the group imports it into this version of Moss.',
                )}
              </li>`
            : nothing}
          ${!hadTools && r.status !== 'error'
            ? html`<li>${msg('This group had no Tools.')}</li>`
            : nothing}
        </ul>
      </div>
    `;
  }

  render() {
    return html`
      <div class="moss-card column card">
        <div class="dialog-title title">${msg('Import finished')}</div>

        <div class="section-title">${msg('Identity')}</div>
        <p class="line">
          ${this.copied.identity
            ? msg('Your identity from the earlier profile is imported.')
            : msg(
                'The earlier profile had no identity that Moss could import. Moss made a new one.',
              )}
        </p>

        <div class="section-title">${msg('Groups')}</div>
        ${this.results.length
          ? this.results.map((r) => this._renderGroup(r))
          : html`<p class="line">${msg('The earlier profile had no groups to import.')}</p>`}

        <div class="row buttons">
          <language-picker></language-picker>
          <span class="flex-1"></span>
          <button
            class="moss-button"
            @click=${() =>
              this.dispatchEvent(new CustomEvent('continue', { bubbles: true, composed: true }))}
          >
            ${msg('Continue')}
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
        margin-bottom: 8px;
      }
      .section-title {
        font-weight: 600;
        margin-top: 20px;
      }
      .line {
        margin: 4px 0 0 0;
      }
      .group {
        margin-top: 10px;
      }
      .group-name {
        font-weight: 500;
      }
      ul {
        margin: 4px 0 0 0;
        padding-left: 20px;
      }
      li {
        margin-bottom: 4px;
      }
      .problem {
        color: var(--moss-hint-green);
      }
      .failed {
        text-decoration: underline dotted;
      }
      .buttons {
        align-items: center;
        gap: 12px;
        margin-top: 28px;
      }
    `,
  ];
}
