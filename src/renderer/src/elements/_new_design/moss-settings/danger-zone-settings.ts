import { customElement, state } from 'lit/decorators.js';
import { css, html, LitElement } from 'lit';
import { localized, msg } from '@lit/localize';
import { GroupImportResult, ImportGroupsProgress } from '../../../electron-api.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';

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

  private _progressHandler = (_e: Electron.IpcRendererEvent, payload: ImportGroupsProgress) => {
    this.importProgress = payload;
  };

  override connectedCallback() {
    super.connectedCallback();
    window.electronAPI.onImportGroupsProgress(this._progressHandler);
  }

  render() {
    return html`
      <div class="column">
        <div>
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
          
        <div style="margin-top: 40px;">
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
    `,
  ];
}
