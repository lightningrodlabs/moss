import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import type { AudioCapabilities } from '@theweave/moss-types';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import { mossStyles } from '../../../shared-styles.js';
import { PersistedStore } from '../../../persisted-store.js';
import { getAudioCapabilities, stopAudioSources } from '../../../electron-api.js';
import { audioSourceGrants } from '../../../audio-sources/grants-store.js';
import { formatGrantSummary } from '../../../audio-sources/grant-summary.js';

/** The Audio Sources capability: kill switch, what this host can do, and who is capturing right now. */
@localized()
@customElement('moss-audio-sources-settings')
export class MossAudioSourcesSettings extends LitElement {
  private _persistedStore = new PersistedStore();
  _grants = new StoreSubscriber(this, () => audioSourceGrants, () => []);

  @state() _enabled = true;
  @state() _capabilities: AudioCapabilities | undefined;

  async firstUpdated() {
    this._enabled = this._persistedStore.audioSourcesEnabled.value();
    this._capabilities = await getAudioCapabilities();
  }

  private toggle(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    this._persistedStore.audioSourcesEnabled.set(checked);
    this._enabled = checked;
  }

  private yesNo(v: boolean) {
    return v ? msg('yes') : msg('no');
  }

  renderCapabilities() {
    const c = this._capabilities;
    if (!c) return html``;
    if (!c.supported)
      return html`<p class="muted">${msg('Audio capture is not available on this system.')}${c.reason ? html` (${c.reason})` : ''}</p>`;
    return html`
      <table class="caps">
        <tr><td>${msg('Backend')}</td><td>${c.backend}</td></tr>
        <tr><td>${msg('Per-app capture')}</td><td>${this.yesNo(c.perApp)}${c.reason ? html` (${c.reason})` : ''}</td></tr>
        <tr><td>${msg('Excludes Moss playback')}</td><td>${this.yesNo(c.canExcludeSelf)}</td></tr>
      </table>
    `;
  }

  renderGrants() {
    const grants = this._grants.value;
    if (grants.length === 0) return html`<p class="muted">${msg('No tool is using audio sources.')}</p>`;
    const now = Date.now();
    return grants.map((g) => {
      const s = formatGrantSummary(g, now);
      return html`
        <div class="row items-center grant">
          <div class="column" style="flex: 1;">
            <span>${s.title}</span>
            <span class="muted small">${msg('Started')} ${new Date(g.startedAt).toLocaleTimeString()} · ${s.elapsed} · drops ${g.counters.chunksDropped + g.counters.backlogDropped} · stalls ${g.counters.stalls}</span>
          </div>
          <sl-button size="small" variant="danger" outline @click=${() => stopAudioSources(g.grantId, 'user-stopped')}>${msg('Stop')}</sl-button>
        </div>
      `;
    });
  }

  render() {
    return html`
      <div class="column" style="gap: 16px;">
        <sl-switch .checked=${this._enabled} @sl-change=${(e: Event) => this.toggle(e)}>${msg('Allow tools to request audio sources')}</sl-switch>
        ${this.renderCapabilities()}
        <h4 style="margin: 0;">${msg('Active grants')}</h4>
        ${this.renderGrants()}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      .muted { opacity: 0.7; }
      .small { font-size: 12px; }
      .caps td { padding: 2px 12px 2px 0; }
      .grant { padding: 8px 12px; border-radius: 6px; background: rgba(0, 0, 0, 0.05); gap: 8px; }
    `,
  ];
}
