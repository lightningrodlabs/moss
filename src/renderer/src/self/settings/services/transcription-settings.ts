// The Transcription service (Settings > Services > Transcription). Lets the user control on-device speech
// recognition:
//   - Global enable switch (persisted; default off). While off, tools
//     cannot open ASR sessions regardless of per-tool consent.
//   - Info icon reveals the current ASR capabilities (model, languages,
//     latency tier) on hover, for diagnosing a setup.
//   - Lists per-tool consent decisions with Revoke buttons.
//
// Turning the switch off or revoking a tool's consent also closes any
// ASR sessions that are open at that moment, so the decision takes
// effect immediately rather than at the next session open.

import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/details/details.js';
import '../../../ui/moss-dialog.js';
import type { MossDialog } from '../../../ui/moss-dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import type { AppletId, LocalModelCapabilities } from '@theweave/api';
import { decodeHashFromBase64 } from '@holochain/client';

import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { APPLET_ASR_CONSENT_CHANGED_EVENT } from '../../../persisted-store.js';
import { mossStyles } from '../../../shared-styles.js';
import { resolveAppletName } from '../../../applets/applet-name.js';
import { getAsrRendererBridge } from '../../../applets/asr-bridge.js';

interface GrantRow {
  appletId: AppletId;
  value: 'granted' | 'denied';
  name: string;
}

@localized()
@customElement('moss-transcription-settings')
export class MossTranscriptionSettings extends LitElement {
  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @state() private enabled = false;
  @state() private capabilities: LocalModelCapabilities | null = null;
  @state() private capabilitiesError: string | null = null;
  @state() private grants: GrantRow[] = [];

  private onGrantsChanged = () => {
    void this.refreshGrants();
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.enabled = this.mossStore.persistedStore.localAiEnabled.value();
    void this.refresh();
    window.addEventListener(APPLET_ASR_CONSENT_CHANGED_EVENT, this.onGrantsChanged);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(APPLET_ASR_CONSENT_CHANGED_EVENT, this.onGrantsChanged);
  }

  private async refresh(): Promise<void> {
    await Promise.all([this.refreshCapabilities(), this.refreshGrants()]);
  }

  private async refreshCapabilities(): Promise<void> {
    this.capabilitiesError = null;
    try {
      this.capabilities = await window.electronAPI.asrCapabilities();
    } catch (e) {
      this.capabilitiesError = (e as Error).message;
      this.capabilities = null;
    }
  }

  private async refreshGrants(): Promise<void> {
    const raw = this.mossStore.persistedStore.listAppletAsrConsents();
    const rows = await Promise.all(
      raw.map(
        async (g): Promise<GrantRow> => ({
          ...g,
          name: await resolveAppletName(this.mossStore, decodeHashFromBase64(g.appletId)),
        }),
      ),
    );
    rows.sort((a, b) => {
      if (a.value !== b.value) return a.value === 'granted' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    this.grants = rows;
  }

  private onEnabledChange(checked: boolean): void {
    this.enabled = checked;
    this.mossStore.persistedStore.localAiEnabled.set(checked);
    if (!checked) void getAsrRendererBridge().closeAllSessions();
  }

  private revoke(appletId: AppletId): void {
    this.mossStore.persistedStore.revokeAppletAsrConsent(appletId);
    void getAsrRendererBridge().closeSessionsForApplet(appletId);
    void this.refreshGrants();
  }

  @query('#about-dialog')
  private _aboutDialog!: MossDialog;

  private renderTechnicalDetails() {
    if (this.capabilitiesError) {
      return html`<div class="error">${this.capabilitiesError}</div>`;
    }
    const caps = this.capabilities?.asr;
    if (!caps) return html`<div>${msg('No capabilities reported.')}</div>`;
    const langs =
      caps.languages.length === 0
        ? msg('(none)')
        : caps.languages.slice(0, 20).join(', ') +
          (caps.languages.length > 20 ? ` …+${caps.languages.length - 20} more` : '');
    return html`
      <div class="caps-table">
        <div><b>${msg('Runtime:')}</b> whisper.cpp (whisper-server)</div>
        <div><b>${msg('Available:')}</b> ${caps.available ? msg('yes') : msg('no')}</div>
        <div><b>${msg('Model:')}</b> ${caps.model || msg('(none)')}</div>
        <div><b>${msg('Streaming partials:')}</b> ${caps.streaming ? msg('yes') : msg('no')}</div>
        <div><b>${msg('Latency tier:')}</b> ${caps.latencyTier}</div>
        <div><b>${msg('Languages:')}</b> ${caps.languages.length} — ${langs}</div>
      </div>
    `;
  }

  private renderGrants() {
    if (this.grants.length === 0) {
      return html`<p class="subtle">
        ${msg(
          'No tools have been granted local transcription access yet. The first time a tool asks, you will be prompted.',
        )}
      </p>`;
    }
    return html`
      <div class="column grants">
        ${this.grants.map(
          (g) => html`
            <div class="row grant-row">
              <div class="column" style="flex: 1; min-width: 0;">
                <span class="grant-name">${g.name}</span>
                <span class="grant-meta"
                  >${g.value === 'granted' ? msg('Allowed') : msg('Denied')}</span
                >
              </div>
              <sl-button size="small" variant="default" @click=${() => this.revoke(g.appletId)}>
                ${msg('Revoke')}
              </sl-button>
            </div>
          `,
        )}
      </div>
    `;
  }

  render() {
    return html`
      <div class="column" style="padding: 0 20px; gap: 24px;">
        <section>
          <div class="row" style="align-items: center; gap: 12px;">
            <h3 style="margin: 0; flex: 1;">${msg('Speech recognition')}</h3>
            <span
              class="info-icon"
              tabindex="0"
              role="button"
              aria-label=${msg('About transcription')}
              @click=${() => this._aboutDialog.show()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') this._aboutDialog.show();
              }}
              >ⓘ</span
            >
            <sl-switch
              ?checked=${this.enabled}
              @sl-change=${(e: Event) =>
                this.onEnabledChange((e.target as HTMLInputElement).checked)}
            >
              ${this.enabled ? msg('Enabled') : msg('Disabled')}
            </sl-switch>
          </div>
          <p class="subtle" style="margin: 8px 0 0 0;">
            ${msg(
              'Moss runs speech-to-text on this device. Tools request access the first time they need it; you can review and revoke those decisions below.',
            )}
          </p>
        </section>

        <section>
          <h3 style="margin: 0 0 8px 0;">${msg('Tool permissions')}</h3>
          ${this.renderGrants()}
        </section>
      </div>
      ${this.renderAboutDialog()}
    `;
  }

  private renderAboutDialog() {
    return html`
      <moss-dialog id="about-dialog" width="780px" headerAlign="left">
        <span slot="header">${msg('About transcription')}</span>
        <div slot="content" class="column about" style="gap: 16px;">
          <p>
            ${msg(
              'All transcription happens on this computer. Your audio is turned into text by a speech model that runs locally, and nothing is sent to a server for processing.',
            )}
          </p>
          <p>
            ${msg(
              html`Moss uses
                <a
                  href="https://en.wikipedia.org/wiki/Whisper_(speech_recognition_system)"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Whisper</a
                >, an open speech recognition model, running through whisper.cpp.`,
            )}
          </p>
          <p>
            ${msg(
              'A tool only gets access after you allow it, the first time it asks. You can withdraw that under Tool permissions, and turning the switch off stops every tool at once.',
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
    css`
      :host {
        display: flex;
      }
      .info-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        font-size: 14px;
        cursor: pointer;
        color: var(--sl-color-neutral-600, #666);
        user-select: none;
      }
      .info-icon:hover {
        color: var(--moss-purple, #6200ea);
      }
      .about p {
        margin: 0;
        font-size: 16px;
        line-height: 1.5;
      }
      .about a {
        color: var(--moss-purple, #6200ea);
      }
      .caps-table {
        font-family: monospace;
        font-size: 12px;
        line-height: 1.6;
        text-align: left;
        padding: 8px 0 0 0;
      }
      .subtle {
        opacity: 0.7;
        font-size: 13px;
      }
      .error {
        color: var(--sl-color-danger-600, #b00);
        font-family: monospace;
      }
      .grants {
        gap: 8px;
      }
      .grant-row {
        padding: 10px 12px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.04);
        align-items: center;
        gap: 12px;
      }
      .grant-name {
        font-weight: 500;
      }
      .grant-meta {
        font-size: 12px;
        opacity: 0.6;
      }
    `,
  ];
}
