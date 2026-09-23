import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import { wrapPathInSvg } from '@holochain-open-dev/elements';
import { mdiVolumeHigh } from '@mdi/js';

import { mossStyles } from '../shared-styles.js';
import { stopAudioSources } from '../electron-api.js';
import { audioSourceGrants } from './grants-store.js';
import { formatGrantSummary } from './grant-summary.js';

/**
 * One chip per active audio-source grant, fixed at the top centre of the main
 * window so the user always sees which Tool is hearing their system audio and
 * can stop it in one click.
 */
@localized()
@customElement('moss-audio-source-chips')
export class MossAudioSourceChips extends LitElement {
  _grants = new StoreSubscriber(this, () => audioSourceGrants, () => []);

  @state() _now = Date.now();
  private _ticker: ReturnType<typeof setInterval> | undefined;

  connectedCallback() {
    super.connectedCallback();
    this._ticker = setInterval(() => (this._now = Date.now()), 1000);
  }

  disconnectedCallback() {
    if (this._ticker) clearInterval(this._ticker);
    super.disconnectedCallback();
  }

  render() {
    const grants = this._grants.value;
    if (grants.length === 0) return html``;
    return html`
      <div class="row chips">
        ${grants.map((g) => {
          const summary = formatGrantSummary(g, this._now);
          return html`
            <div class="chip row items-center" title=${summary.title}>
              <sl-icon .src=${wrapPathInSvg(mdiVolumeHigh)}></sl-icon>
              <span class="text">${msg(str`${g.toolName} is using system audio`)} · ${summary.elapsed}</span>
              <sl-button size="small" variant="danger" outline @click=${() => stopAudioSources(g.grantId, 'user-stopped')}
                >${msg('Stop')}</sl-button
              >
            </div>
          `;
        })}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        position: fixed;
        top: 6px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1000;
        pointer-events: none;
      }
      .chips {
        gap: 8px;
      }
      .chip {
        pointer-events: auto;
        gap: 8px;
        padding: 4px 8px 4px 12px;
        border-radius: 999px;
        background: #b23a3a;
        color: white;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        font-size: 14px;
      }
    `,
  ];
}
