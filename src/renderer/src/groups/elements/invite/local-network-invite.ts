import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { notify } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/checkbox/checkbox.js';

import { LanInviteSession } from '../../../lan-invite/lan-invite-session.js';
import { mossStyles } from '../../../shared-styles.js';

/**
 * Lets a member admit people who are asking, over the local network, to join
 * this group. The session backing this is only alive while the element is on
 * the page: connecting opens it, disconnecting closes it, and closing is what
 * stops listening and drops the ephemeral keys behind it. The dialog mounts
 * this element only while it is open, so that lifetime is the dialog's.
 */
/**
 * How long an announcement runs if nothing stops it sooner. Closing the pane
 * already ends it, so this only bounds a pane left open and walked away from.
 * Long enough to outlast a session in a room rather than to be noticed.
 */
const ADVERTISE_WINDOW_MS = 30 * 60 * 1000;

@localized()
@customElement('local-network-invite')
export class LocalNetworkInvite extends LitElement {
  @property({ type: String })
  inviteCode!: string;

  @property({ type: String })
  groupName!: string;

  private session = new LanInviteSession(window.electronAPI);

  _intents = new StoreSubscriber(
    this,
    () => this.session.intents,
    () => [],
  );

  _offering = new StoreSubscriber(
    this,
    () => this.session.offering,
    () => [],
  );

  @state()
  private selected = new Set<string>();

  /**
   * Who we have already sent an invite to. This records what this computer
   * did, not what the other person did with it: whether they went on to
   * join is group state that cannot be tied back to a name on the network.
   * Their beacon stops once they are admitted, so the row ages out shortly
   * after of its own accord.
   */
  @state()
  private invited = new Set<string>();

  @state()
  private remaining = '';

  private countdown: ReturnType<typeof setInterval> | undefined;

  connectedCallback(): void {
    super.connectedCallback();
    void this.session.open();
    // The countdown redraws the label every second; the engine — not this
    // timer — is what actually closes the window when the deadline passes.
    this.countdown = setInterval(() => {
      const offering = this._offering.value;
      if (!offering) {
        this.remaining = '';
        return;
      }
      const left = Math.max(0, offering.until - Date.now());
      const minutes = Math.floor(left / 60_000);
      const seconds = Math.floor((left % 60_000) / 1000);
      this.remaining = `${minutes}:${String(seconds).padStart(2, '0')}`;
      if (left === 0) this.session.stopOffer();
    }, 1000);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.countdown !== undefined) {
      clearInterval(this.countdown);
      this.countdown = undefined;
    }
    // disconnectedCallback is synchronous, but tearing the session down is
    // not: the socket close and key wipe both go through async IPC calls.
    // There is nothing left to await into once the element is gone, so the
    // teardown is fired and its failure merely logged rather than swallowed.
    this.session.close().catch((e) => console.error('Failed to close LAN invite session:', e));
  }

  private toggle(sid: string, checked: boolean): void {
    const next = new Set(this.selected);
    if (checked) next.add(sid);
    else next.delete(sid);
    this.selected = next;
  }

  private async admit(): Promise<void> {
    const sids = [...this.selected];
    const admitted = await this.session.admit(sids, this.inviteCode, this.groupName);
    if (admitted.length) this.invited = new Set([...this.invited, ...admitted]);
    this.selected = new Set();
    // A row picked here can have become ambiguous the moment before this ran
    // (a second beacon for the same name landed in between), in which case
    // the engine silently drops it — so what actually went out, not what was
    // ticked, decides what the member is told.
    if (admitted.length === 0) {
      notify(
        msg(
          'No invite was sent — a selected name may have just become ambiguous. Ask them to start again.',
        ),
      );
    } else if (admitted.length < sids.length) {
      notify(
        msg(
          str`Invite sent to ${admitted.length} of ${sids.length}. The rest may have just become ambiguous — ask them to start again.`,
        ),
      );
    } else {
      notify(msg('Invite sent over the local network.'));
    }
  }

  render() {
    const intents = this._intents.value ?? [];
    return html`
      <div class="column" style="gap: 8px;">
        <div class="column section">
          <span class="section-title">${msg('Let people join on their own')}</span>
          ${this._offering.value
            ? html`
                <div class="row broadcasting">
                  <span>${msg('Listing this group on the local network')}</span>
                  <button
                    class="moss-button-secondary stop"
                    @click=${() => this.session.stopOffer()}
                  >
                    ${msg('Stop')}
                  </button>
                </div>
                <span class="countdown"
                  >${msg(str`auto-stopping listing in ${this.remaining}`)}</span
                >
              `
            : html`
                <button
                  class="moss-button action"
                  @click=${() =>
                    this.session.offerGroup(this.groupName, this.inviteCode, ADVERTISE_WINDOW_MS)}
                >
                  ${msg('List Group')}
                </button>
                <span class="hint"
                  >${msg('While listing, anyone on this network can join the group.')}</span
                >
              `}
        </div>

        <div class="divider"></div>

        <div class="column section">
          <span class="section-title">${msg('Admit people yourself')}</span>
          <span class="hint">${msg('Ask people to announce themselves.')}</span>
          ${intents.length === 0
            ? html`<span class="empty">${msg('Nobody is announcing themselves currently.')}</span>`
            : html`
                ${intents.map(
                  (intent) => html`
                    <div class="row intent">
                      <sl-checkbox
                        .checked=${this.selected.has(intent.sid)}
                        .disabled=${intent.ambiguous || this.invited.has(intent.sid)}
                        @sl-change=${(e: CustomEvent) =>
                          this.toggle(intent.sid, (e.target as HTMLInputElement).checked)}
                      >
                        ${intent.name}
                      </sl-checkbox>
                      ${this.invited.has(intent.sid)
                        ? html`<span class="badge">${msg('Invite sent')}</span>`
                        : html``}
                      ${intent.ambiguous
                        ? html`<span class="ambiguous"
                            >${msg(
                              'Two people are showing this name — ask one of them to start again.',
                            )}</span
                          >`
                        : html``}
                    </div>
                  `,
                )}
                <button
                  class="moss-button action"
                  .disabled=${this.selected.size === 0}
                  @click=${() => this.admit()}
                >
                  ${msg('Send Invite')}
                </button>
              `}
        </div>
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: block;
      }
      .intent {
        align-items: center;
        gap: 12px;
      }
      .broadcasting {
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
      }
      /* Beside a sentence rather than under it, so this one is sized to its
         label with even padding instead of taking the action column's width. */
      .stop {
        flex: 0 0 auto;
        padding: 8px 18px;
      }
      .section {
        gap: 8px;
        align-items: flex-start;
        width: 100%;
      }
      /* One width for every action, pushed to the right, so a growing list of
         people does not shuffle the buttons around under the reader. */
      .action {
        width: 180px;
        align-self: flex-end;
      }
      .section-title {
        font-size: 16px;
        font-weight: 600;
      }
      .divider {
        height: 1px;
        margin: 20px 0;
        background: var(--moss-grey-light, rgba(0, 0, 0, 0.12));
      }
      .countdown {
        font-size: 12px;
        opacity: 0.45;
      }
      .badge {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--moss-grey-light, rgba(0, 0, 0, 0.08));
        opacity: 0.8;
      }
      .empty,
      .ambiguous,
      .hint {
        font-size: 14px;
        opacity: 0.7;
      }
    `,
  ];
}
