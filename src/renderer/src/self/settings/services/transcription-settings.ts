// The Transcription service (Settings > Services > Transcription). Lets the user control on-device speech
// recognition:
//   - Global enable switch (persisted; default off). While off, tools
//     cannot open ASR sessions regardless of per-tool consent.
//   - Info icon opens an about dialog: what runs locally, and the
//     current capabilities (model, languages, latency tier) behind a
//     technical-details turn-down.
//   - Model section: lists the available speech models with download,
//     resume, cancel, delete and select. Switching the active model stops
//     open sessions, so it asks for confirmation when any are open.
//   - Lists per-tool consent decisions with Revoke buttons.
//
// Turning the switch off or revoking a tool's consent also closes any
// ASR sessions that are open at that moment, so the decision takes
// effect immediately rather than at the next session open.

import { consume } from '@lit/context';
import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/details/details.js';
import './asr-model-list.js';
import '../../../ui/moss-dialog.js';
import type { MossDialog } from '../../../ui/moss-dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';

import type { AppletId, LocalModelCapabilities } from '@theweave/api';
import type {
  AsrModelDownloadEnded,
  AsrModelDownloadProgress,
  AsrModelListEntry,
} from '@theweave/moss-types';
import { decodeHashFromBase64 } from '@holochain/client';

import { mossStoreContext } from '../../../context.js';
import { MossStore } from '../../../moss-store.js';
import { APPLET_ASR_CONSENT_CHANGED_EVENT } from '../../../persisted-store.js';
import { mossStyles } from '../../../shared-styles.js';
import { serviceStyles } from './service-styles.js';
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
  @state() private models: AsrModelListEntry[] = [];
  @state() private progress: Map<string, AsrModelDownloadProgress> = new Map();
  @state() private modelErrors: Map<string, string> = new Map();
  @state() private pendingSwitch: {
    id: string;
    sessions: number;
    action: 'select' | 'delete';
  } | null = null;

  @query('#switch-dialog')
  private _switchDialog!: MossDialog;

  private onDownloadProgress = (_e: Electron.IpcRendererEvent, p: AsrModelDownloadProgress) => {
    const next = new Map(this.progress);
    next.set(p.id, p);
    this.progress = next;
  };

  private onDownloadEnded = (_e: Electron.IpcRendererEvent, ended: AsrModelDownloadEnded) => {
    this.clearProgress(ended.id);
    this.setModelError(ended.id, ended.outcome === 'error' ? (ended.error ?? null) : null);
    void Promise.all([this.refreshModels(), this.refreshCapabilities()]);
  };

  private unsubscribeProgress: (() => void) | null = null;
  private unsubscribeEnded: (() => void) | null = null;

  private onGrantsChanged = () => {
    void this.refreshGrants();
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.enabled = this.mossStore.persistedStore.localAiEnabled.value();
    void this.refresh();
    window.addEventListener(APPLET_ASR_CONSENT_CHANGED_EVENT, this.onGrantsChanged);
    this.unsubscribeProgress = window.electronAPI.onAsrModelDownloadProgress(
      this.onDownloadProgress,
    );
    this.unsubscribeEnded = window.electronAPI.onAsrModelDownloadEnded(this.onDownloadEnded);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener(APPLET_ASR_CONSENT_CHANGED_EVENT, this.onGrantsChanged);
    this.unsubscribeProgress?.();
    this.unsubscribeProgress = null;
    this.unsubscribeEnded?.();
    this.unsubscribeEnded = null;
  }

  private async refresh(): Promise<void> {
    await Promise.all([this.refreshCapabilities(), this.refreshGrants(), this.refreshModels()]);
  }

  private async refreshModels(): Promise<void> {
    try {
      this.models = await window.electronAPI.asrModelsList();
    } catch (e) {
      this.capabilitiesError = (e as Error).message;
    }
  }

  private setModelError(id: string, message: string | null): void {
    const next = new Map(this.modelErrors);
    if (message === null) next.delete(id);
    else next.set(id, message);
    this.modelErrors = next;
  }

  private clearProgress(id: string): void {
    const next = new Map(this.progress);
    next.delete(id);
    this.progress = next;
  }

  private async downloadModel(id: string): Promise<void> {
    this.setModelError(id, null);
    try {
      await window.electronAPI.asrModelDownload({ id });
    } catch (e) {
      this.setModelError(id, (e as Error).message);
    } finally {
      this.clearProgress(id);
      await Promise.all([this.refreshModels(), this.refreshCapabilities()]);
    }
  }

  private async cancelDownload(id: string): Promise<void> {
    await window.electronAPI.asrModelCancelDownload({ id });
  }

  /** Deleting the active model stops every open tool session, so ask first when there are any. */
  private async requestDelete(id: string): Promise<void> {
    const active = this.models.find((m) => m.id === id)?.active ?? false;
    if (active && (await this.confirmIfSessionsOpen(id, 'delete'))) return;
    await this.deleteModel(id);
  }

  private async deleteModel(id: string): Promise<void> {
    this.setModelError(id, null);
    try {
      await window.electronAPI.asrModelDelete({ id });
    } catch (e) {
      this.setModelError(id, (e as Error).message);
    }
    await Promise.all([this.refreshModels(), this.refreshCapabilities()]);
  }

  /** Switching stops every open tool session, so ask first when there are any. */
  private async requestSelect(id: string): Promise<void> {
    if (await this.confirmIfSessionsOpen(id, 'select')) return;
    await this.selectModel(id);
  }

  /** Opens the confirm dialog and returns true when sessions are open. */
  private async confirmIfSessionsOpen(id: string, action: 'select' | 'delete'): Promise<boolean> {
    const sessions = await window.electronAPI.asrOpenSessionCount();
    if (sessions === 0) return false;
    this.pendingSwitch = { id, sessions, action };
    await this.updateComplete;
    this._switchDialog.show();
    return true;
  }

  private async confirmSwitch(): Promise<void> {
    const pending = this.pendingSwitch;
    this.pendingSwitch = null;
    this._switchDialog.hide();
    if (!pending) return;
    if (pending.action === 'delete') await this.deleteModel(pending.id);
    else await this.selectModel(pending.id);
  }

  private async selectModel(id: string): Promise<void> {
    this.setModelError(id, null);
    try {
      await window.electronAPI.asrModelSelect({ id });
    } catch (e) {
      this.setModelError(id, (e as Error).message);
    }
    await Promise.all([this.refreshModels(), this.refreshCapabilities()]);
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
      return html`<div class="service-error">${this.capabilitiesError}</div>`;
    }
    const caps = this.capabilities?.asr;
    if (!caps) return html`<div>${msg('No capabilities reported.')}</div>`;
    const langs =
      caps.languages.length === 0
        ? msg('(none)')
        : caps.languages.slice(0, 20).join(', ') +
          (caps.languages.length > 20 ? ` …+${caps.languages.length - 20} more` : '');
    return html`
      <div class="service-details">
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
      return html`<p class="service-empty">
        ${msg(
          'No tools have been granted local transcription access yet. The first time a tool asks, you will be prompted.',
        )}
      </p>`;
    }
    return html`
      <div class="service-listbox">
        ${this.grants.map(
          (g) => html`
            <div class="service-line">
              <span class="service-line-name">${g.name}</span>
              <span class="service-line-meta"
                >${g.value === 'granted' ? msg('Allowed') : msg('Denied')}</span
              >
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
      <div class="column service-pane">
        <section>
          <div class="row service-heading">
            <h3>${msg('Speech recognition')}</h3>
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
          <p class="service-note">
            ${msg(
              'Moss runs speech-to-text on this device. Tools request access the first time they need it; you can review and revoke those decisions below.',
            )}
          </p>
        </section>

        <section>
          <h3 style="margin: 0 0 8px 0;">${msg('Tool permissions')}</h3>
          ${this.renderGrants()}
        </section>

        <section>
          <h3 style="margin: 0 0 8px 0;">${msg('Model')}</h3>
          <p class="service-note" style="margin: 0 0 8px 0;">
            ${msg(
              'Choose which speech model Moss runs. Larger models are more accurate but slower and use more memory.',
            )}
          </p>
          <asr-model-list
            .models=${this.models}
            .progress=${this.progress}
            .errors=${this.modelErrors}
            @model-download=${(e: CustomEvent<{ id: string }>) =>
              void this.downloadModel(e.detail.id)}
            @model-cancel=${(e: CustomEvent<{ id: string }>) =>
              void this.cancelDownload(e.detail.id)}
            @model-delete=${(e: CustomEvent<{ id: string }>) =>
              void this.requestDelete(e.detail.id)}
            @model-select=${(e: CustomEvent<{ id: string }>) =>
              void this.requestSelect(e.detail.id)}
          ></asr-model-list>
          <sl-details class="model-help" summary=${msg('Which model should I use?')}>
            <div class="column" style="gap: 10px;">
              <p>
                ${msg(
                  'An English-only model (.en) and the multilingual model of the same name are the same size because they are the same design, trained on different speech. For English, tiny.en and base.en are noticeably more accurate than tiny and base. From small upward the difference is slight.',
                )}
              </p>
              <p>
                ${msg(
                  'Choose a multilingual model if anyone will speak a language other than English. An English-only model turns other languages into nonsense.',
                )}
              </p>
              <p>
                ${msg(
                  'A bigger model is more accurate, but each step up is several times slower and needs more memory: roughly 0.4 GB for base, 0.9 GB for small, 2 GB for medium and 4 GB for large. On most laptops medium and large cannot keep up with live speech, so captions arrive late. Pick the largest model that still keeps up.',
                )}
              </p>
              <p>
                ${msg(
                  'large-v3-turbo is nearly as accurate as large-v3 and several times faster. Try it before large-v3.',
                )}
              </p>
            </div>
          </sl-details>
        </section>
      </div>
      ${this.renderAboutDialog()} ${this.renderSwitchDialog()}
    `;
  }

  private renderSwitchDialog() {
    const n = this.pendingSwitch?.sessions ?? 0;
    return html`
      <moss-dialog id="switch-dialog" width="520px" headerAlign="left">
        <span slot="header">${msg('Switch speech model?')}</span>
        <div slot="content" class="column" style="gap: 16px;">
          <p>
            ${n === 1
              ? msg(
                  '1 transcription session is active. Switching the model stops it now. Tools will need to start transcription again, for example by rejoining a room.',
                )
              : msg(
                  str`${n} transcription sessions are active. Switching the model stops them now. Tools will need to start transcription again, for example by rejoining a room.`,
                )}
          </p>
          <div class="row" style="justify-content: flex-end; gap: 8px;">
            <sl-button
              @click=${() => {
                this.pendingSwitch = null;
                this._switchDialog.hide();
              }}
              >${msg('Cancel')}</sl-button
            >
            <sl-button variant="primary" @click=${() => void this.confirmSwitch()}
              >${msg('Switch')}</sl-button
            >
          </div>
        </div>
      </moss-dialog>
    `;
  }

  private renderAboutDialog() {
    return html`
      <moss-dialog id="about-dialog" width="780px" headerAlign="left">
        <span slot="header">${msg('About transcription')}</span>
        <div slot="content" class="column service-about" style="gap: 16px;">
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
    serviceStyles,
    css`
      :host {
        display: flex;
      }
      .model-help {
        margin-top: 8px;
      }
      .model-help p {
        margin: 0;
        font-size: 13px;
        line-height: 1.5;
      }
    `,
  ];
}
