import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import { LanInviteSession } from '../../lan-invite/lan-invite-session.js';
import { announceIcon } from '../../ui/icons.js';
import { mossStyles } from '../../shared-styles.js';

const INTENT_WINDOW_MS = 10 * 60 * 1000;

/**
 * How long to keep saying "looking" before admitting nothing is out there.
 * A member's beacon repeats every few seconds, so anything on this network
 * should have arrived well inside this.
 */
const SCAN_SETTLE_MS = 8000;

/**
 * The newcomer's half of both local-network flows: take a group that is being
 * offered here, or ask to be let in by name. Both are on screen at once and
 * neither replaces the other, because a newcomer cannot tell which one the
 * room is using — and a group may start advertising after they have already
 * asked.
 *
 * The session backing this is only alive while the element is on the page:
 * connecting opens it, disconnecting closes it, and closing is what stops the
 * broadcast and drops the ephemeral keys behind it. The dialog mounts this
 * element only while the local-network mode is showing, so that lifetime is
 * also when this computer is listening.
 */
@localized()
@customElement('local-network-join')
export class LocalNetworkJoin extends LitElement {
  /**
   * Names of groups this computer has already joined. The beacon carries no
   * group identity — only a name — so this can mark a likely match but never
   * prove one, which is why a marked row stays actionable.
   */
  @property({ type: Array })
  joinedGroupNames: string[] = [];

  private session = new LanInviteSession(window.electronAPI);

  _myName = new StoreSubscriber(
    this,
    () => this.session.myName,
    () => [],
  );

  _receivedInvite = new StoreSubscriber(
    this,
    () => this.session.receivedInvite,
    () => [],
  );

  _offers = new StoreSubscriber(
    this,
    () => this.session.offers,
    () => [],
  );

  _intending = new StoreSubscriber(
    this,
    () => this.session.intending,
    () => [],
  );

  _requesting = new StoreSubscriber(
    this,
    () => this.session.requesting,
    () => [],
  );

  @state()
  private starting = false;

  @state()
  private settled = false;

  @state()
  private remaining = '';

  /**
   * Bumped once a second purely to redraw. The ages below are read from the
   * beacon times, so without this they would freeze until something else
   * changed — and a stale age is exactly what makes a list look wrong.
   */
  @state()
  private tick = 0;

  private countdown: ReturnType<typeof setInterval> | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;

  connectedCallback(): void {
    super.connectedCallback();
    void this.startListening();
    this.settleTimer = setTimeout(() => {
      this.settled = true;
    }, SCAN_SETTLE_MS);
    // The countdown redraws the label every second; the engine — not this
    // timer — is what actually closes the window when the deadline passes.
    this.countdown = setInterval(() => {
      this.tick++;
      const intending = this._intending.value;
      if (!intending) {
        this.remaining = '';
        return;
      }
      const left = Math.max(0, intending.until - Date.now());
      const minutes = Math.floor(left / 60_000);
      const seconds = Math.floor((left % 60_000) / 1000);
      this.remaining = `${minutes}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.countdown !== undefined) {
      clearInterval(this.countdown);
      this.countdown = undefined;
    }
    if (this.settleTimer !== undefined) {
      clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
    // disconnectedCallback is synchronous, but tearing the session down is
    // not: the socket close and key wipe both go through async IPC calls.
    // There is nothing left to await into once the element is gone, so the
    // teardown is fired and its failure merely logged rather than swallowed.
    this.session.close().catch((e) => console.error('Failed to close LAN invite session:', e));
  }

  /**
   * On the very first launch this element can be on screen before the main
   * process has registered the beacon channels, so a refused start is worth
   * retrying rather than leaving the pane permanently deaf.
   */
  private async startListening(attempt = 0): Promise<void> {
    try {
      await this.session.open();
    } catch (e) {
      if (!this.isConnected || attempt >= 10) {
        console.error('Could not start listening on the local network:', e);
        return;
      }
      setTimeout(() => void this.startListening(attempt + 1), 1000);
    }
  }

  private async start(): Promise<void> {
    this.starting = true;
    try {
      await this.session.advertiseIntent(INTENT_WINDOW_MS);
    } finally {
      this.starting = false;
    }
  }

  private accept(invite: { code: string; groupName: string }): void {
    this.dispatchEvent(
      new CustomEvent('local-invite-received', {
        detail: invite,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Whether this computer is currently announcing itself. The host reads it to
   * warn that closing will stop it.
   */
  get announcing(): boolean {
    return this._intending.value !== undefined;
  }

  /** Whole seconds since a beacon for this entry last arrived. */
  private secondsAgo(lastSeen: number): number {
    return Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  }

  /** Whether a group of this name is already on this computer. */
  private alreadyJoined(groupName: string): boolean {
    const normalise = (name: string) => name.trim().toLowerCase();
    return this.joinedGroupNames.some((joined) => normalise(joined) === normalise(groupName));
  }

  private renderOffer(offer: {
    sid: string;
    groupName: string;
    ambiguous: boolean;
    lastSeen: number;
  }) {
    const requesting = this._requesting.value;
    const pending = requesting?.sid === offer.sid && requesting.state === 'pending';
    const noReply = requesting?.sid === offer.sid && requesting.state === 'no-reply';

    return html`
      <div class="row offer">
        <div class="row" style="align-items: center; gap: 8px;">
          <span>${offer.groupName}</span>
          ${this.alreadyJoined(offer.groupName)
            ? html`<span class="badge">${msg('Joined')}</span>`
            : html``}
          <span class="age">${msg(str`seen ${this.secondsAgo(offer.lastSeen)}s ago`)}</span>
        </div>
        ${offer.ambiguous
          ? html`<span class="hint"
              >${msg('Two groups are showing this name — ask which is which.')}</span
            >`
          : html`<div class="column" style="align-items: flex-end; gap: 4px;">
              <button
                class="moss-button"
                .disabled=${pending}
                @click=${() => this.session.requestInvite(offer.sid)}
              >
                ${pending ? html`<sl-spinner></sl-spinner>` : msg('Request access')}
              </button>
              ${noReply
                ? html`<span class="hint"
                    >${msg(
                      'No reply. This network may be blocking it — try again, or ask for an invite link.',
                    )}</span
                  >`
                : html``}
            </div>`}
      </div>
    `;
  }

  private renderGroups() {
    const offers = this._offers.value ?? [];
    return html`
      <div class="column section">
        <span class="section-title">${msg('Listed Groups')}</span>
        ${offers.length
          ? offers.map((offer) => this.renderOffer(offer))
          : this.settled
            ? html`<span class="hint">${msg('None found')}</span>`
            : html`<span class="hint row" style="align-items: center; gap: 8px;"
                ><sl-spinner></sl-spinner>${msg('Looking for groups on this network…')}</span
              >`}
      </div>
    `;
  }

  private renderIntent() {
    const name = this._myName.value;
    if (name) {
      return html`
        <div class="panel column">
          <span>${msg('You are announced on this network as')}</span>
          <span class="name">${name}</span>
          <span class="hint"
            >${msg('Tell the person adding you this name, so they can add you to the group.')}</span
          >
          <span class="hint">${msg('Visible for')} <strong>${this.remaining}</strong></span>
          <button class="moss-button-secondary" @click=${() => this.session.stopIntent()}>
            ${msg('Stop')}
          </button>
        </div>
      `;
    }

    return html`
      <div class="column section" style="align-items: flex-start;">
        <span class="section-title">${msg('Unlisted Groups')}</span>
        <span class="hint"
          >${msg(
            'If someone in an unlisted group is adding you, announce yourself here and tell them the name that appears.',
          )}</span
        >
        <button
          class="moss-button announce"
          .disabled=${this.starting}
          @click=${() => this.start()}
        >
          ${this.starting
            ? html`<sl-spinner></sl-spinner>`
            : html`<div class="row center-content">
                ${announceIcon(20)}
                <div style="margin-left: 10px;">${msg('Announce Myself')}</div>
              </div>`}
        </button>
      </div>
    `;
  }

  render() {
    const invite = this._receivedInvite.value;
    if (invite) {
      return html`
        <div class="panel column">
          <span class="admitted"
            >${msg('You have been invited to')} <strong>${invite.groupName}</strong></span
          >
          <button class="moss-button" @click=${() => this.accept(invite)}>
            ${msg('Join Group')}
          </button>
        </div>
      `;
    }

    return html` ${this.renderGroups()} ${this.renderIntent()} `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: block;
      }
      /* Hidden while another tab is showing, but still mounted: the session
         lives with the dialog, not with whichever tab is in front. */
      :host([hidden]) {
        display: none;
      }
      .section {
        gap: 8px;
        width: 100%;
        margin-bottom: 20px;
      }
      .announce {
        align-self: center;
      }
      .section-title {
        font-size: 16px;
        font-weight: 600;
      }
      .panel {
        width: 100%;
        box-sizing: border-box;
        align-items: center;
        gap: 8px;
        padding: 16px;
        border-radius: 12px;
        background: var(--moss-grey-light, rgba(0, 0, 0, 0.04));
      }
      .name {
        font-size: 22px;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .offer {
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 36px;
      }
      .age {
        font-size: 12px;
        opacity: 0.5;
      }
      .badge {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--moss-grey-light, rgba(0, 0, 0, 0.08));
        opacity: 0.8;
      }
      .hint,
      .admitted {
        font-size: 14px;
        opacity: 0.8;
      }
      .admitted {
        text-align: center;
      }
    `,
  ];
}
