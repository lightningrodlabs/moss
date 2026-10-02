import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { StoreSubscriber, toPromise } from '@holochain-open-dev/stores';
import { notifyError, sharedStyles } from '@holochain-open-dev/elements';
import { consume } from '@lit/context';
import '@holochain-open-dev/profiles/dist/elements/profiles-context.js';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/card/card.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import SlDialog from '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/details/details.js';

import { groupStoreContext } from '../context.js';
import { GroupStore } from '../group-store.js';
import { MossStore } from '../../moss-store.js';
import { mossStoreContext } from '../../context.js';
import { encodeHashToBase64 } from '@holochain/client';
import { dialogMessagebox } from '../../electron-api.js';
import { telescopeIcon } from '../../ui/icons.js';
import { mossStyles } from '../../shared-styles.js';
import { groupModifiersToAppId } from '../../utils.js';
import { deriveSyncProgress, SyncProgress, withKnownPeers } from '../sync-progress.js';

@localized()
@customElement('looking-for-peers')
export class LookingForPeers extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  @state()
  leaving = false;

  /** Progress derived from the latest metrics snapshot. */
  @state()
  _progress: SyncProgress | undefined;

  /** Ticks the "last data received" wording forward between snapshots. */
  @state()
  _now = Date.now();

  private _unsubscribeMetrics: (() => void) | undefined;
  private _clockInterval: ReturnType<typeof setInterval> | undefined;

  _knownPeers = new StoreSubscriber(
    this,
    () => this.groupStore.knownAgentsCount,
    () => [this.groupStore],
  );

  _onlinePeers = new StoreSubscriber(
    this,
    () => this.groupStore.onlinePeersCount,
    () => [this.groupStore],
  );

  async connectedCallback() {
    super.connectedCallback();
    this._clockInterval = setInterval(() => (this._now = Date.now()), 1000);
    const appId = await groupModifiersToAppId(await toPromise(this.groupStore.modifiers));
    // The screen may have been removed while the app id was resolving
    if (!this.isConnected || this._unsubscribeMetrics) return;
    const dnaHashB64 = encodeHashToBase64(this.groupStore.groupDnaHash);
    this._unsubscribeMetrics = this.mossStore.networkMetricsPoller.subscribe(
      appId,
      { includeDhtSummary: false },
      (dump) => {
        this._progress = deriveSyncProgress({
          previous: this._progress,
          metrics: dump[dnaHashB64],
          knownPeers: this._knownPeers.value ?? 0,
          now: Date.now(),
        });
      },
      (e) => console.warn('Failed to read sync metrics for the waiting group:', e),
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribeMetrics?.();
    this._unsubscribeMetrics = undefined;
    if (this._clockInterval) clearInterval(this._clockInterval);
    this._clockInterval = undefined;
  }

  async leaveGroup() {
    const confirmation = await dialogMessagebox({
      message:
        'WARNING: Leaving a group will refresh Moss. Save any unsaved content in Tools of other groups before you proceed.',
      type: 'warning',
      buttons: ['Cancel', 'Continue'],
    });
    if (confirmation.response === 0) return;

    this.leaving = true;

    const groupDnaHash = this.groupStore.groupDnaHash;
    try {
      await this.mossStore.leaveGroup(groupDnaHash);
      window.location.reload();
    } catch (e) {
      notifyError(msg('Error leaving the group'));
      console.error(e);
    }

    this.leaving = false;
  }

  public showLeaveDialog(): void {
    this.dialog.show();
  }

  public hideLeaveDialog(): void {
    this.dialog.hide();
  }

  get dialog(): SlDialog {
    return this.shadowRoot?.getElementById('leave-group-dialog') as SlDialog;
  }

  renderLeaveGroupDialog() {
    return html`<sl-dialog
      id="leave-group-dialog"
      .label=${msg('Leave Group')}
      @sl-request-close=${(e) => {
        if (this.leaving) {
          e.preventDefault();
        }
      }}
    >
      <span>${msg('Are you sure you want to leave this group?')}</span>

      <sl-button slot="footer" @click=${() => this.dialog.hide()}>${msg('Cancel')}</sl-button>
      <sl-button
        slot="footer"
        variant="danger"
        .loading=${this.leaving}
        @click=${() => this.leaveGroup()}
        >${msg('Leave')}</sl-button
      >
    </sl-dialog>`;
  }

  render() {
    return html`
      ${this.renderLeaveGroupDialog()}
      <sl-button
        variant="danger"
        @click=${() => this.dialog.show()}
        style="position: absolute; top: 10px; right: 10px;"
        >${msg('Leave Group')}
      </sl-button>
      <div class="column center-content" style="flex: 1">
        ${telescopeIcon(120)}
        <div class="dot-carousel" style="margin-top: 20px; --carousel-color: black;"></div>
        ${this.renderStatus(withKnownPeers(this._progress, this._knownPeers.value ?? 0, this._now))}
        <span style="max-width: 600px; text-align: center; margin-top: 40px;"
          >${msg('The group ID is: ')}<pre></pre>${encodeHashToBase64(
            this.groupStore.groupDnaHash,
          )}</pre></span
        >
      </div>
    `;
  }

  renderStatus(p: SyncProgress) {
    switch (p.stage) {
      case 'no-peers':
        return html`
          <h2>${msg('Looking for peers...')}</h2>
          <span style="max-width: 600px; text-align: center"
            >${msg(
              "No peers found yet to fetch the group's meta data. Ask one of the members of this group to launch Moss so that you can start synchronizing with them.",
            )}</span
          >
        `;
      case 'connecting':
        return html`
          <h2>${msg(str`Found ${p.peersFound} peer(s). Connecting...`)}</h2>
          ${this.renderLiveness(p)} ${this.renderDetails(p)}
        `;
      case 'syncing':
        return html`
          <h2>${msg(str`Syncing with ${p.peersFound} peer(s)...`)}</h2>
          ${this.renderLiveness(p)} ${this.renderDetails(p)}
        `;
      case 'caught-up':
        return html`
          <h2>${msg("Synced with peers. Waiting for the group's details...")}</h2>
          ${this.renderLiveness(p)} ${this.renderDetails(p)}
        `;
    }
  }

  renderLiveness(p: SyncProgress) {
    if (p.lastActivityAt === undefined) {
      return html`<span class="liveness">${msg('Waiting for data...')}</span>`;
    }
    const seconds = Math.max(0, Math.round((this._now - p.lastActivityAt) / 1000));
    const active = seconds < 5;
    return html`<span class="liveness">
      <span class="liveness-dot ${active ? 'active' : ''}"></span>
      ${active ? msg('Receiving data') : msg(str`Last data received ${seconds}s ago`)}
    </span>`;
  }

  renderDetails(p: SyncProgress) {
    const online = this._onlinePeers.value;
    return html`
      <sl-details summary=${msg('Details')} class="sync-details">
        <div class="details-grid">
          <span>${msg('Peers found')}</span><span>${p.peersFound}</span>
          ${online !== undefined
            ? html`<span>${msg('Peers online')}</span><span>${online}</span>`
            : ''}
          <span>${msg('Peers synced with')}</span><span>${p.peersSyncedWith}</span>
          ${p.localOpCount !== undefined
            ? html`<span>${msg('Data items held')}</span
                ><span
                  >${p.highestPeerOpCount !== undefined
                    ? `${p.localOpCount} / ${p.highestPeerOpCount}`
                    : p.localOpCount}</span
                >`
            : ''}
          <span>${msg('Items downloading')}</span><span>${p.pendingFetches}</span>
          <span>${msg('Active sync sessions')}</span><span>${p.activeRounds}</span>
          ${p.lastGossipAt !== undefined
            ? html`<span>${msg('Last sync')}</span
                ><span>${new Date(p.lastGossipAt).toLocaleTimeString()}</span>`
            : ''}
        </div>
      </sl-details>
    `;
  }

  static styles = [
    sharedStyles,
    mossStyles,
    css`
      .liveness {
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0.8;
      }
      .liveness-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #bbb;
      }
      .liveness-dot.active {
        background: var(--moss-fishy-green);
        animation: pulse 1.2s ease-in-out infinite;
      }
      @keyframes pulse {
        50% {
          opacity: 0.3;
        }
      }
      .sync-details {
        margin-top: 16px;
        width: 360px;
      }
      .details-grid {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 4px 16px;
        font-size: 14px;
      }
    `,
  ];
}
