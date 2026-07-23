import { customElement, state } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { GroupImportResult, ImportGroupsProgress, NetworkOverridesInfo } from '../../../electron-api.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';

import { mossStyles } from '../../../shared-styles.js';

@localized()
@customElement('moss-danger-zone-settings')
export class MossDangerZoneSettings extends LitElement {
  @state()
  isMigrating = false;

  @state()
  isImporting = false;

  @state()
  importProgress: ImportGroupsProgress | undefined = undefined;

  @state()
  importResults: GroupImportResult | undefined = undefined;

  @state()
  private _networkInfo: NetworkOverridesInfo | undefined = undefined;

  @state()
  private _bootstrapUrlInput = '';

  @state()
  private _relayUrlInput = '';

  private _progressHandler = (_e: Electron.IpcRendererEvent, payload: ImportGroupsProgress) => {
    this.importProgress = payload;
  };

  override connectedCallback() {
    super.connectedCallback();
    window.electronAPI.onImportGroupsProgress(this._progressHandler);
    this._loadNetworkInfo();
  }

  private async _loadNetworkInfo() {
    try {
      this._networkInfo = await window.electronAPI.getNetworkOverrides();
      this._bootstrapUrlInput = this._networkInfo.current.bootstrapUrl;
      this._relayUrlInput = this._networkInfo.current.relayUrl;
    } catch (e) {
      console.error('Failed to load network overrides:', e);
    }
  }

  private get _hasOverrides(): boolean {
    if (!this._networkInfo) return false;
    return !!(this._networkInfo.overrides.bootstrapUrl || this._networkInfo.overrides.relayUrl);
  }

  private get _hasChanges(): boolean {
    if (!this._networkInfo) return false;
    return (
      this._bootstrapUrlInput !== this._networkInfo.current.bootstrapUrl ||
      this._relayUrlInput !== this._networkInfo.current.relayUrl
    );
  }

  render() {
    return html`
      <div class="column">
        <div >
          <div><b>${msg('Migrate Groups')}</b></div>
          <sl-button
            class="migrate-button"
            ?loading=${this.isMigrating}
            @click=${async () => {
        this.isMigrating = true;
        try {
          await window.electronAPI.exportGroupsData();
        } catch (e) {
          console.error('Error during export:', e);
          alert(msg('An error occurred during export. Please check the console for details.'));
        } finally {
          this.isMigrating = false;
        }
      }}
          >
            ${msg('Export Groups Data')}
          </sl-button>
          <sl-button
            class="migrate-button"
            ?loading=${this.isImporting}
            @click=${async () => {
        this.isImporting = true;
        this.importResults = undefined;
        try {
          this.importResults = await window.electronAPI.importGroupsData();
          window.location.reload();
        } catch (e) {
          console.error('Error during import:', e);
          alert(msg('An error occurred during import. Please check the console for details.'));
        } finally {
          this.isImporting = false;
        }
      }}
          >
            ${msg('Import Groups Data')}
          </sl-button>
          ${this.isImporting && this.importProgress ? html`
            <div style="margin-top: 12px; padding: 10px; background: #f0f0f0; border-radius: 8px; font-size: 13px;">
              <div style="margin-bottom: 6px; color: #555;">
                ${msg('Group')} ${this.importProgress.current} / ${this.importProgress.total}
              </div>
              <div>
                <b>${this.importProgress.groupName ?? msg('Unknown group')}</b>:
                ${this.importProgress.step === 'installing' ? msg('Installing...') :
          this.importProgress.step === 'setting-profile' ? msg('Setting group profile...') :
            this.importProgress.step === 'waiting-for-sync' ? html`${msg('Waiting for data to sync...')} (${this.importProgress.secondsLeft}s)` :
              this.importProgress.step === 'installing-tool' ? html`${msg('Installing tool')} "${this.importProgress.toolName}" (${this.importProgress.toolIndex}/${this.importProgress.toolTotal})...` :
                ''}
              </div>
            </div>
          ` : ''}
          ${this.importResults && !this.isImporting ? html`
            <div style="margin-top: 12px; padding: 10px; background: #f0f0f0; border-radius: 8px; font-size: 13px;">
              ${this.importResults.map((r) => html`
                <div style="margin-bottom: 4px;">
                  <b>${r.groupName ?? msg('Unknown group')}</b>:
                  ${r.status === 'created' ? msg('Created') :
                    r.status === 'joined' ? msg('Joined') :
                      r.status === 'joined-no-profile' ? msg('Joined (profile not yet synced)') :
                        r.status === 'already-installed' ? msg('Already installed') :
                          msg('Error')}
                  ${r.error ? html` — <span style="color: red;">${r.error}</span>` : ''}
                </div>
              `)}
            </div>
          ` : ''}
        </div>
          
        <div class="settings-section">
          <div><b>${msg('Network Configuration')}</b></div>
          ${this._networkInfo ? html`
            <div class="column" style="gap: 12px; margin-top: 12px;">
              <div>
                <label style="font-size: 13px; font-weight: 500;">${msg('Bootstrap URL')}</label>
                <sl-input
                  style="margin-top: 4px;"
                  value=${this._bootstrapUrlInput}
                  placeholder=${this._networkInfo.defaults.bootstrapUrl}
                  @sl-input=${(e: Event) => {
          this._bootstrapUrlInput = (e.target as HTMLInputElement).value;
        }}
                ></sl-input>
              </div>
              <div>
                <label style="font-size: 13px; font-weight: 500;">${msg('Relay URL')}</label>
                <sl-input
                  style="margin-top: 4px;"
                  value=${this._relayUrlInput}
                  placeholder=${this._networkInfo.defaults.relayUrl}
                  @sl-input=${(e: Event) => {
          this._relayUrlInput = (e.target as HTMLInputElement).value;
        }}
                ></sl-input>
              </div>
              <div
                class="row items-center"
                style="background: #fff3cd; padding: 10px 15px; border-radius: 8px; margin-top: 4px;"
              >
                <span style="flex: 1; font-size: 13px; color: #664d03;">
                  ${msg('Changing these settings will relaunch Moss. All peers must use the same bootstrap server to connect.')}
                </span>
                <div class="row" style="gap: 8px; margin-left: 12px; flex-shrink: 0;">
                  ${this._hasOverrides ? html`
                    <sl-button
                      variant="default"
                      @click=${async () => {
            await window.electronAPI.clearNetworkOverrides();
          }}
                    >
                      ${msg('Reset to Defaults')}
                    </sl-button>
                  ` : ''}
                  <sl-button
                    variant="warning"
                    ?disabled=${!this._hasChanges}
                    @click=${async () => {
          await window.electronAPI.setNetworkOverrides({
            bootstrapUrl: this._bootstrapUrlInput || undefined,
            relayUrl: this._relayUrlInput || undefined,
          });
        }}
                  >
                    ${msg('Save & Relaunch')}
                  </sl-button>
                </div>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="settings-section" >
          <div><b>${msg('Factory Reset')}</b></div>
          <div
            class="row items-center"
            style="background: #ffaaaa; padding: 10px 15px; border-radius: 8px; margin-top: 12px;"
          >
            <span style="margin-right: 20px; flex: 1;">
              ${msg('Fully reset Moss and')} <b>${msg('delete all associated data')}</b>
            </span>
            <sl-button
              variant="danger"
              @click=${async () => await window.electronAPI.factoryReset()}
            >
              ${msg('Factory Reset')}
            </sl-button>
          </div>
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
      sl-button.migrate-button {
        margin-top: 12px;
      }
      .settings-section {
        margin-top: 25px;
      }
    `,
  ];
}
