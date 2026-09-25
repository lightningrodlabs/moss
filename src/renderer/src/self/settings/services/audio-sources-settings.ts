import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import type { AudioCapabilities } from '@theweave/moss-types';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/details/details.js';
import '../../../ui/moss-dialog.js';
import type { MossDialog } from '../../../ui/moss-dialog.js';

import { mossStyles } from '../../../shared-styles.js';
import { serviceStyles } from './service-styles.js';
import { PersistedStore } from '../../../persisted-store.js';
import { getAudioCapabilities, stopAudioSources } from '../../../electron-api.js';
import { audioSourceGrants } from '../../../audio-sources/grants-store.js';
import { formatGrantSummary } from '../../../audio-sources/grant-summary.js';

/** The Audio Sources service: kill switch, who is capturing right now, and what this host can do. */
@localized()
@customElement('moss-audio-sources-settings')
export class MossAudioSourcesSettings extends LitElement {
  private _persistedStore = new PersistedStore();
  _grants = new StoreSubscriber(
    this,
    () => audioSourceGrants,
    () => [],
  );

  @state() _enabled = true;
  @state() _capabilities: AudioCapabilities | undefined;

  @query('#about-dialog')
  private _aboutDialog!: MossDialog;

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

  private renderTechnicalDetails() {
    const c = this._capabilities;
    if (!c) return html`<div class="service-details">${msg('No capabilities reported.')}</div>`;
    if (!c.supported)
      return html`<div class="service-details">
        ${msg('Audio capture is not available on this system.')}${c.reason
          ? html` (${c.reason})`
          : ''}
      </div>`;
    return html`
      <div class="service-details">
        <div><b>${msg('Backend:')}</b> ${c.backend}</div>
        <div>
          <b>${msg('Per-app capture:')}</b> ${this.yesNo(c.perApp)}${c.reason
            ? html` (${c.reason})`
            : ''}
        </div>
        <div><b>${msg('Excludes Moss playback:')}</b> ${this.yesNo(c.canExcludeSelf)}</div>
      </div>
    `;
  }

  private renderPermissions() {
    const grants = this._grants.value;
    if (grants.length === 0) {
      return html`<p class="service-empty">
        ${msg(
          'No tool is capturing audio right now. Each time a tool asks, you pick the source it may capture.',
        )}
      </p>`;
    }
    const now = Date.now();
    return html`
      <div class="column service-rows">
        ${grants.map((g) => {
          const s = formatGrantSummary(g, now);
          const dropped = g.counters.chunksDropped + g.counters.backlogDropped;
          return html`
            <div class="row service-row">
              <div class="column" style="flex: 1; min-width: 0;">
                <span class="service-row-name">${s.title}</span>
                <span class="service-row-meta">
                  ${msg('Capturing')} ${s.elapsed} · ${msg('started')}
                  ${new Date(g.startedAt).toLocaleTimeString()} · ${msg('dropped')} ${dropped} ·
                  ${msg('stalls')} ${g.counters.stalls}
                </span>
              </div>
              <sl-button
                size="small"
                variant="default"
                @click=${() => stopAudioSources(g.grantId, 'user-stopped')}
                >${msg('Stop')}</sl-button
              >
            </div>
          `;
        })}
      </div>
    `;
  }

  render() {
    return html`
      <div class="column service-pane">
        <section>
          <div class="row service-heading">
            <h3>${msg('Audio capture')}</h3>
            <span
              class="info-icon"
              tabindex="0"
              role="button"
              aria-label=${msg('About audio capture')}
              @click=${() => this._aboutDialog.show()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') this._aboutDialog.show();
              }}
              >ⓘ</span
            >
            <sl-switch .checked=${this._enabled} @sl-change=${(e: Event) => this.toggle(e)}>
              ${this._enabled ? msg('Enabled') : msg('Disabled')}
            </sl-switch>
          </div>
          <p class="service-note">
            ${msg(
              'Tools can ask to capture audio playing on this computer. You choose the source each time a tool asks, and you can stop a capture below while it runs.',
            )}
          </p>
        </section>

        <section>
          <h3 style="margin: 0 0 8px 0;">${msg('Active permissions')}</h3>
          ${this.renderPermissions()}
        </section>
      </div>
      ${this.renderAboutDialog()}
    `;
  }

  private renderAboutDialog() {
    return html`
      <moss-dialog id="about-dialog" width="780px" headerAlign="left">
        <span slot="header">${msg('About audio capture')}</span>
        <div slot="content" class="column service-about" style="gap: 16px;">
          <p>
            ${msg(
              'Moss can pass audio that is playing on this computer to a tool — the sound of a meeting app, for example, or everything coming out of your speakers.',
            )}
          </p>
          <p>
            ${msg(
              'Every request opens a picker where you choose exactly which source that tool may capture. Moss does not send the audio anywhere itself; what a tool does with the audio it receives is up to that tool.',
            )}
          </p>
          <p>
            ${msg(
              'Turning the switch off stops tools from asking at all, and a capture that is already running can be stopped under Active permissions.',
            )}
          </p>
          <sl-details summary=${msg('Technical details')}>
            ${this.renderTechnicalDetails()}
          </sl-details>
        </div>
      </moss-dialog>
    `;
  }

  static styles = [
    mossStyles,
    serviceStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];
}
