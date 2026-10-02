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
import { dataFlowArrow, syncStatusBadge, syncStatusStyles } from './sync-status-visuals.js';
import { serviceStyles } from '../../self/settings/services/service-styles.js';
import {
  deriveSyncProgress,
  Elapsed,
  elapsedSince,
  SyncProgress,
  withKnownPeers,
} from '../sync-progress.js';

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
        const metrics = dump[dnaHashB64];
        // A reading without this group would read as all counters reset
        if (!metrics) return;
        this._progress = deriveSyncProgress({
          previous: this._progress,
          metrics,
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
        style="position: absolute; top: 10px; right: 10px; z-index: 1;"
        >${msg('Leave Group')}
      </sl-button>
      <div class="scroller">
        <div class="column center-content content">
        ${this.renderStatus(withKnownPeers(this._progress, this._knownPeers.value ?? 0, this._now))}
        <span style="max-width: 600px; text-align: center; margin-top: 40px;"
          >${msg('The group ID is: ')}<pre></pre>${encodeHashToBase64(
            this.groupStore.groupDnaHash,
          )}</pre></span
        >
        </div>
      </div>
    `;
  }

  /**
   * Only the heading and hint change with the stage. The liveness line and
   * Details stay in one place so an open Details panel survives a stage change.
   */
  renderStatus(p: SyncProgress) {
    const waiting = p.stage === 'no-peers';
    return html`
      ${telescopeIcon(120)}
      <h2>${this.headingText(p)}</h2>
      ${syncStatusBadge(p.stage)} ${this.renderHint(p)}
      <div class="column center-content" style=${waiting ? 'display: none;' : ''}>
        ${this.renderLiveness(p)} ${this.renderDetails(p)}
      </div>
    `;
  }

  headingText(p: SyncProgress): string {
    switch (p.stage) {
      case 'no-peers':
        return msg('Looking for peers...');
      case 'found':
        return msg(str`Found ${p.peersFound} peer(s). Connecting...`);
      case 'unreachable':
        return msg(str`Found ${p.peersFound} peer(s), but cannot reach them yet`);
      case 'connected':
        return msg(str`Connected to ${Math.max(p.peersConnected, 1)} peer(s). Syncing...`);
    }
  }

  renderHint(p: SyncProgress) {
    switch (p.stage) {
      case 'no-peers':
        return html`<span class="hint"
          >${msg(
            "No peers found yet to fetch the group's meta data. Ask one of the members of this group to launch Moss so that you can start synchronizing with them.",
          )}</span
        >`;
      case 'unreachable':
        return html`<span class="hint"
          >${msg(
            'They may be offline, or a network or firewall setting may be blocking the connection. Moss keeps trying.',
          )}</span
        >`;
      default:
        return '';
    }
  }

  /** Data arrived within the last few seconds. */
  isReceiving(p: SyncProgress): boolean {
    if (p.lastDataAt === undefined) return false;
    const elapsed = elapsedSince(p.lastDataAt, this._now);
    return elapsed.unit === 'seconds' && elapsed.value < 5;
  }

  renderLiveness(p: SyncProgress) {
    const receiving = this.isReceiving(p);
    const text =
      p.lastDataAt === undefined
        ? msg('No data received yet')
        : receiving
          ? msg('Receiving data')
          : msg(str`Last data received ${this.agoText(elapsedSince(p.lastDataAt, this._now))}`);
    return html`<span class="liveness">${dataFlowArrow(receiving)} ${text}</span>`;
  }

  agoText(elapsed: Elapsed): string {
    switch (elapsed.unit) {
      case 'seconds':
        return msg(str`${elapsed.value}s ago`);
      case 'minutes':
        return msg(str`${elapsed.value} min ago`);
      case 'hours':
        return msg(str`${elapsed.value} h ago`);
    }
  }

  renderDetails(p: SyncProgress) {
    const row = (label: string, value: unknown) =>
      html`<span>${label}</span><span class="value">${value}</span>`;
    return html`
      <sl-details summary=${msg('Details')} class="sync-details">
        <div class="service-details details-grid">
          ${row(msg('Peers found'), p.peersFound)} ${row(msg('Peers connected'), p.peersConnected)}
          ${p.dataReceived !== undefined ? row(msg('Data received'), p.dataReceived) : ''}
          ${row(msg('Items downloading'), p.pendingFetches)}
          ${row(msg('Active sync sessions'), p.activeRounds)}
          ${p.lastGossipAt !== undefined
            ? row(msg('Last sync'), this.agoText(elapsedSince(p.lastGossipAt, this._now)))
            : ''}
          ${p.failedAttempts > 0 ? row(msg('Failed attempts'), p.failedAttempts) : ''}
        </div>
      </sl-details>
    `;
  }

  static styles = [
    sharedStyles,
    mossStyles,
    serviceStyles,
    syncStatusStyles,
    css`
      :host {
        position: relative;
      }
      /* Out of flow, so the screen never grows its ancestors; it scrolls
         itself when the window is too short, for example with Details open */
      .scroller {
        position: absolute;
        inset: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }
      /* Centered while it fits; starts at the top once it scrolls */
      .content {
        margin: auto 0;
        flex: none;
      }
      .status-badge {
        margin-bottom: 12px;
      }
      .hint {
        margin-bottom: 12px;
        max-width: 600px;
        text-align: center;
      }
      .liveness {
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0.8;
      }
      .sync-details {
        margin-top: 16px;
        width: 360px;
      }
      /* The sl-details panel already pads its content */
      .service-details.details-grid {
        display: grid;
        grid-template-columns: 1fr auto;
        column-gap: 16px;
        padding-top: 0;
      }
      .details-grid .value {
        text-align: right;
      }
    `,
  ];
}
