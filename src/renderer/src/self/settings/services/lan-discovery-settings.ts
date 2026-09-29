// The Local Discovery service (Settings > Services > Local Discovery). One
// switch for mDNS LAN discovery, which lets group members on the same local
// network find and reach each other directly, including when the bootstrap
// and relay servers are unreachable.
//
// The conductor reads the setting only when it starts, so the switch saves the
// choice for the next launch and the pane offers a relaunch while the saved
// choice and the running one differ.

import { css, html, LitElement } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/details/details.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '../../../ui/moss-dialog.js';
import type { MossDialog } from '../../../ui/moss-dialog.js';

import type { LanDiscoveryInfo } from '../../../electron-api.js';
import { mossStyles } from '../../../shared-styles.js';
import { serviceStyles } from './service-styles.js';

@localized()
@customElement('moss-lan-discovery-settings')
export class MossLanDiscoverySettings extends LitElement {
  @state() private info: LanDiscoveryInfo | undefined;
  @state() private error: string | undefined;
  @state() private relaunching = false;

  @query('#about-dialog')
  private _aboutDialog!: MossDialog;

  connectedCallback(): void {
    super.connectedCallback();
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    try {
      this.info = await window.electronAPI.getLanDiscovery();
      this.error = undefined;
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  private async onEnabledChange(checked: boolean): Promise<void> {
    try {
      await window.electronAPI.setLanDiscovery(checked);
    } catch (e) {
      this.error = (e as Error).message;
    }
    await this.refresh();
  }

  private async relaunch(): Promise<void> {
    this.relaunching = true;
    await window.electronAPI.relaunchMoss();
  }

  private renderPendingRelaunch() {
    const info = this.info;
    if (!info || info.disabledByFlag || info.saved === info.running) return html``;
    return html`
      <div class="row service-row" style="align-items: center; margin-top: 12px;">
        <span style="flex: 1;">
          ${info.saved
            ? msg('Local discovery turns on when Moss relaunches.')
            : msg('Local discovery turns off when Moss relaunches.')}
        </span>
        <sl-button
          size="small"
          variant="primary"
          ?loading=${this.relaunching}
          @click=${() => this.relaunch()}
        >
          ${msg('Relaunch now')}
        </sl-button>
      </div>
    `;
  }

  private renderFlagNote() {
    if (!this.info?.disabledByFlag) return html``;
    return html`<p class="service-note">
      ${msg(
        'Moss was started with --disable-mdns, so local discovery is off for this launch whatever the switch says.',
      )}
    </p>`;
  }

  render() {
    const enabled = this.info?.saved ?? false;
    return html`
      <div class="column service-pane">
        <section>
          <div class="row service-heading">
            <h3>${msg('Local network discovery')}</h3>
            <span
              class="info-icon"
              tabindex="0"
              role="button"
              aria-label=${msg('About local discovery')}
              @click=${() => this._aboutDialog.show()}
              @keypress=${(e: KeyboardEvent) => {
                if (e.key === 'Enter') this._aboutDialog.show();
              }}
              >ⓘ</span
            >
            <sl-switch
              ?checked=${enabled}
              ?disabled=${!this.info}
              @sl-change=${(e: Event) =>
                this.onEnabledChange((e.target as HTMLInputElement).checked)}
            >
              ${enabled ? msg('Enabled') : msg('Disabled')}
            </sl-switch>
          </div>
          <p class="service-note">
            ${msg(
              'Find members of your groups on the same Wi-Fi or local network and connect to them directly, so you can keep working together when the internet or the Moss servers are unreachable. While this is on, this device announces itself on the local network.',
            )}
          </p>
          ${this.renderFlagNote()} ${this.renderPendingRelaunch()}
          ${this.error ? html`<div class="service-error">${this.error}</div>` : ''}
        </section>
      </div>
      ${this.renderAboutDialog()}
    `;
  }

  private renderAboutDialog() {
    return html`
      <moss-dialog id="about-dialog" width="780px" headerAlign="left">
        <span slot="header">${msg('About local discovery')}</span>
        <div slot="content" class="column service-about" style="gap: 16px;">
          <p>
            ${msg(
              'Normally Moss finds the other members of a group through a bootstrap server and connects to them through a relay server on the internet. Local discovery adds a second way: devices on the same local network find each other directly, using mDNS, the same mechanism printers and speakers use to show up on your network.',
            )}
          </p>
          <p>
            ${msg(
              'Each group is announced by a fingerprint, not by its name. Only a device that already knows the group’s network identity can tell which group a fingerprint belongs to, and it must still prove that knowledge before any group data is exchanged.',
            )}
          </p>
          <p>
            ${msg(
              'Other devices on the network can see that this device runs Moss and how to reach it. Leave this off on networks you do not trust.',
            )}
          </p>
          <sl-details summary=${msg('Technical details')}>
            <div class="service-details">
              <div>
                <b>${msg('Saved setting:')}</b> ${this.info?.saved ? msg('on') : msg('off')}
              </div>
              <div>
                <b>${msg('This launch:')}</b> ${this.info?.running ? msg('on') : msg('off')}
              </div>
              <div>
                <b>${msg('Started with --disable-mdns:')}</b>
                ${this.info?.disabledByFlag ? msg('yes') : msg('no')}
              </div>
            </div>
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
