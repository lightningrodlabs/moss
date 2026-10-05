import { css, html, LitElement, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
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
import { mossStyles } from '../../shared-styles.js';
import { groupModifiersToAppId } from '../../utils.js';
import { dataFlowArrow, syncStatusBadge, syncStatusStyles } from './sync-status-visuals.js';
import { syncStageIcons, syncStageIconStyles } from './sync-stage-icons.js';
import { morphTransform } from './sync-morph.js';
import { serviceStyles } from '../../self/settings/services/service-styles.js';
import { DisplayStage, gateStage, GateState } from '../stage-gate.js';
import { finalTimeline, MORPH_MS, SYNCED_HOLD_MS, TimerBag } from '../sync-final-sequence.js';
import {
  deriveSyncProgress,
  Elapsed,
  elapsedSince,
  SyncProgress,
  withKnownPeers,
} from '../sync-progress.js';

export { MORPH_MS, SYNCED_HOLD_MS };

/**
 * The waiting screen shown until the group profile is known. Once `synced` is
 * set it shows a closing message, holds it, then morphs its icon onto
 * `morphTarget`. It announces the morph with `sync-screen-morph` and its end
 * with `sync-screen-done`.
 */
@localized()
@customElement('looking-for-peers')
export class LookingForPeers extends LitElement {
  @consume({ context: groupStoreContext, subscribe: true })
  groupStore!: GroupStore;

  @consume({ context: mossStoreContext, subscribe: true })
  mossStore!: MossStore;

  /** Set by group-home once the group profile is known; starts the final sequence. */
  @property({ type: Boolean })
  synced = false;

  /** Resolves the element whose bounding rect the icon morphs onto, read when the morph starts. */
  @property({ attribute: false })
  morphTarget: (() => HTMLElement | null | undefined) | undefined;

  @state()
  leaving = false;

  /** The stage on screen, which trails the derived stage by the minimum dwell. */
  @state()
  private _gate: GateState = { shown: 'no-peers', shownAt: Date.now(), pending: undefined };

  @state()
  private _morphing = false;

  private _timers = new TimerBag();
  private _cancelGateTimer: (() => void) | undefined;

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
    this.resumeSequence();
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
        this.wantStage(this.synced ? 'synced' : this._progress.stage);
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
    this._timers.clear();
    this._cancelGateTimer = undefined;
  }

  updated(changed: PropertyValues<this>) {
    if (changed.has('synced') && this.synced) this.wantStage('synced');
  }

  /** Asks for a stage to be shown; it appears once the current one has had its minimum time. */
  private wantStage(stage: DisplayStage) {
    // The synced message is final
    if (this._gate.shown === 'synced') return;
    const { state, delayMs } = gateStage(this._gate, stage, Date.now());
    this._gate = state;
    this._cancelGateTimer?.();
    this._cancelGateTimer = undefined;
    if (delayMs !== undefined) {
      this._cancelGateTimer = this._timers.set(() => {
        if (this._gate.pending) this.wantStage(this._gate.pending);
      }, delayMs);
    }
    if (state.shown === 'synced') this.startFinalSequence(state.shownAt);
  }

  /** Runs from its own timers, since metrics may stop once the group profile is known. */
  private startFinalSequence(syncedAt: number) {
    const { morphAt, doneAt } = finalTimeline(syncedAt);
    const now = Date.now();
    this._timers.set(() => this.startMorph(), morphAt - now);
    this._timers.set(
      () =>
        this.dispatchEvent(new CustomEvent('sync-screen-done', { bubbles: true, composed: true })),
      doneAt - now,
    );
  }

  /** Restarts whatever was pending when the screen was last removed from the page. */
  private resumeSequence() {
    if (this._gate.shown === 'synced') {
      this._morphing = false;
      this.removeAttribute('morphing');
      const icons = this.iconsElement;
      if (icons) icons.style.transform = '';
      this.startFinalSequence(Date.now());
    } else if (this._gate.pending) {
      this.wantStage(this._gate.pending);
    }
  }

  private get iconsElement(): HTMLElement | null {
    return this.shadowRoot?.querySelector<HTMLElement>('.stage-icons') ?? null;
  }

  /** Moves the icon onto the target; without a usable target it only fades. */
  private startMorph() {
    const icons = this.iconsElement;
    const transform = icons
      ? morphTransform(icons.getBoundingClientRect(), this.morphTarget?.()?.getBoundingClientRect())
      : undefined;
    if (icons && transform) icons.style.transform = transform;
    this._morphing = true;
    this.setAttribute('morphing', '');
    this.dispatchEvent(new CustomEvent('sync-screen-morph', { bubbles: true, composed: true }));
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
        class="leave ${this._morphing ? 'out' : ''}"
        variant="danger"
        @click=${() => this.dialog.show()}
        style="position: absolute; top: 10px; right: 10px; z-index: 1;"
        >${msg('Leave Group')}
      </sl-button>
      <div class="scroller">
        <div
          class="column center-content content ${
            this._gate.shown === 'synced' ? 'final' : ''
          } ${this._morphing ? 'out' : ''}"
        >
        ${this.renderStatus(withKnownPeers(this._progress, this._knownPeers.value ?? 0, this._now))}
        <span class="group-id" style="max-width: 600px; text-align: center; margin-top: 40px;"
          >${msg('The group ID is: ')}<pre></pre>${encodeHashToBase64(
            this.groupStore.groupDnaHash,
          )}</pre></span
        >
        </div>
      </div>
    `;
  }

  /**
   * Only the icon, heading and hint change with the stage. The liveness line and
   * Details stay in one place so an open Details panel survives a stage change.
   * The stage comes from the gate, the numbers from the latest progress.
   */
  renderStatus(p: SyncProgress) {
    const stage = this._gate.shown;
    const waiting = stage === 'no-peers';
    return html`
      ${syncStageIcons(stage, stage === 'unreachable')}
      <h2>${this.headingText(stage, p)}</h2>
      ${syncStatusBadge(stage)} ${this.renderHint(stage)}
      <div class="column center-content below" style=${waiting ? 'display: none;' : ''}>
        ${this.renderLiveness(stage, p)} ${this.renderDetails(p)}
      </div>
    `;
  }

  headingText(stage: DisplayStage, p: SyncProgress): string {
    switch (stage) {
      case 'no-peers':
        return msg('Looking for peers...');
      case 'found':
        return msg(str`Found ${p.peersFound} peer(s). Connecting...`);
      case 'unreachable':
        return msg(str`Found ${p.peersFound} peer(s), but cannot reach them yet`);
      case 'connected':
        return msg(str`Connected to ${Math.max(p.peersConnected, 1)} peer(s). Syncing...`);
      case 'synced':
        return msg(str`Synced with ${Math.max(p.peersConnected, 1)} peer(s). Opening the group...`);
    }
  }

  renderHint(stage: DisplayStage) {
    switch (stage) {
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

  renderLiveness(stage: DisplayStage, p: SyncProgress) {
    const synced = stage === 'synced';
    const receiving = !synced && this.isReceiving(p);
    const text = synced
      ? msg('All group data received')
      : p.lastDataAt === undefined
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
          ${p.lastSuccessAt !== undefined
            ? row(msg('Last contact'), this.agoText(elapsedSince(p.lastSuccessAt, this._now)))
            : ''}
          ${p.lastAttemptAt !== undefined
            ? row(msg('Last attempt'), this.agoText(elapsedSince(p.lastAttemptAt, this._now)))
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
    syncStageIconStyles,
    css`
      :host {
        position: relative;
      }
      /* The group home underneath is what the user should reach during the morph */
      :host([morphing]) {
        pointer-events: none;
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
        overflow: hidden;
        max-height: 400px;
        transition:
          max-height 380ms ease-in,
          opacity 320ms ease-in 60ms,
          margin 380ms ease-in,
          transform 380ms ease-in;
      }
      /* Synced: everything below the badge folds away, leaving icon and heading */
      .content.final .below,
      .content.final .group-id {
        opacity: 0;
        transition: opacity 320ms ease-in 60ms;
      }
      .content.final .sync-details {
        max-height: 0;
        opacity: 0;
        margin-top: 0;
        border-width: 0;
        transform: translateY(-48px);
      }
      /* Morph: the icon travels to the group header while the rest fades */
      .stage-icons {
        transition:
          transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 240ms ease 360ms;
      }
      .content.out .stage-icons {
        opacity: 0;
      }
      .content h2,
      .content .status-badge,
      .content .hint,
      .leave {
        transition: opacity 300ms ease;
      }
      .content.out h2,
      .content.out .status-badge,
      .content.out .hint,
      .leave.out {
        opacity: 0;
      }
      @media (prefers-reduced-motion: reduce) {
        .stage-icons,
        .sync-details,
        .content.final .below,
        .content.final .group-id,
        .content h2,
        .content .status-badge,
        .content .hint,
        .leave {
          transition-duration: 1ms;
          transition-delay: 0s;
        }
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
