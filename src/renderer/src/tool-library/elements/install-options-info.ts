import { html, LitElement } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '../../ui/moss-dialog.js';
import type { MossDialog } from '../../ui/moss-dialog.js';
import { mossStyles } from '../../shared-styles.js';
import { infoAboutStyles } from '../../ui/info-about-styles.js';

/**
 * The ⓘ beside the "Install options" heading. It opens a short explanation of
 * what DNA properties are and that the chosen values cannot change after the
 * install, so a person knows the form is a one-time decision before they fill
 * it in.
 */
@localized()
@customElement('install-options-info')
export class InstallOptionsInfo extends LitElement {
  @query('#about-dialog')
  private _aboutDialog!: MossDialog;

  render() {
    return html`
      <span
        class="info-icon"
        tabindex="0"
        role="button"
        aria-label=${msg('About install options')}
        @click=${() => this._aboutDialog.show()}
        @keypress=${(e: KeyboardEvent) => {
          if (e.key === 'Enter') this._aboutDialog.show();
        }}
        >ⓘ</span
      >
      <moss-dialog id="about-dialog" width="780px" headerAlign="left">
        <span slot="header">${msg('About install options')}</span>
        <div slot="content" class="column info-about" style="gap: 16px;">
          <p>
            ${msg(
              'These choices are written into the DNA properties of this Tool instance. DNA properties are part of its identity on the network, so everyone who joins the instance gets exactly the same values.',
            )}
          </p>
          <p>
            ${msg(
              'They are permanent. Once the Tool is installed, the values cannot be changed. To use different values, install a new instance of the Tool.',
            )}
          </p>
          <p>
            ${msg(
              'All group members will be able to see the DNA properties in the Tool’s Advanced settings, under DNA Properties.',
            )}
          </p>
        </div>
      </moss-dialog>
    `;
  }

  static styles = [mossStyles, infoAboutStyles];
}
