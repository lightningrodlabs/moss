import { get, writable, type Writable } from '@holochain-open-dev/stores';

import { encodeMessage, LAN_INVITE_PROTOCOL_VERSION } from './protocol.js';
import { createPresence, type HeardIntent, type HeardOffer, type Presence } from './presence.js';

const EXPIRY_TICK_MS = 2000;

/**
 * How long a flow-A join request waits for its sealed reply before the pane
 * says nothing came back. The offer beacon repeats every 3s, so this is several
 * beacons' worth: long enough not to cry wolf on a slow link, short enough that
 * AP client isolation — the failure this design names as most likely — shows as
 * "no reply" rather than as a button that does nothing.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** What a join request is doing, for the button the user pressed. */
export type JoinRequestState = { sid: string; state: 'pending' | 'no-reply' };

/** The slice of the preload bridge this needs, named so a test can stand in for it. */
export type LanBeaconApi = {
  lanBeaconSetListening: (listening: boolean) => Promise<void>;
  lanBeaconStartAdvertising: (
    payload: Uint8Array,
    durationMs: number,
  ) => Promise<number | undefined>;
  lanBeaconSetHello: (payload: Uint8Array) => Promise<void>;
  lanBeaconStopAdvertising: (id?: number) => Promise<void>;
  lanBeaconUnicast: (payload: Uint8Array, address: string, port: number) => Promise<void>;
  lanBeaconDiagnostics: () => Promise<{
    bound: boolean;
    interfaces: string[];
    advertising: boolean;
    advertisementId: number | undefined;
    sent: number;
    received: number;
    dropped: number;
  }>;
  onLanBeaconDatagram: (
    callback: (e: unknown, payload: { bytes: Uint8Array; address: string; port: number }) => void,
  ) => void;
};

export type LanInviteSessionOptions = {
  /** Injectable so a test does not have to wait out the real expiry cadence. */
  tickMs?: number;
  /** Injectable so a test does not have to wait out the real reply timeout. */
  requestTimeoutMs?: number;
};

/**
 * One session per dialog. Opening it turns the socket on; closing it turns the
 * socket off and drops every key and every heard entry, which is what makes the
 * whole exchange ephemeral.
 *
 * The socket is shared and refcounted, but the advertisement slot underneath it
 * is singular: one socket can only put one beacon on the wire. So a session
 * stops only the advertisement it started itself — named by the id the main
 * process hands back — and watches for its own being replaced, so that a
 * displaced session stops claiming to broadcast instead of showing a countdown
 * for a beacon that is no longer going out.
 */
export class LanInviteSession {
  readonly intents: Writable<HeardIntent[]> = writable([]);
  readonly receivedInvite: Writable<{ code: string; groupName: string } | undefined> =
    writable(undefined);
  readonly myName: Writable<string | undefined> = writable(undefined);
  readonly intending: Writable<{ until: number } | undefined> = writable(undefined);
  readonly offers: Writable<HeardOffer[]> = writable([]);
  readonly offering: Writable<{ until: number } | undefined> = writable(undefined);
  readonly requesting: Writable<JoinRequestState | undefined> = writable(undefined);

  private presence: Presence;
  private tick: ReturnType<typeof setInterval> | undefined;
  private listening = false;
  private readonly tickMs: number;
  private readonly requestTimeoutMs: number;
  private requestTimer: ReturnType<typeof setTimeout> | undefined;
  /** The advertisement this session put on the wire, if it currently holds the slot. */
  private advertisementId: number | undefined;
  /**
   * Start, stop and ownership checks all read and write `advertisementId`
   * across an await, so they run one at a time: a stop that arrives while a
   * start is still in flight has to learn the id that start produced before it
   * can name the right advertisement to stop.
   */
  private advertisementQueue: Promise<void> = Promise.resolve();
  // onLanBeaconDatagram registers an ipcRenderer listener that the preload never
  // removes, so this dispatcher is wired to the IPC bridge exactly once per
  // session instance (in the constructor) and its behavior is switched by
  // `listening` instead — reopening the same session cannot pile up handlers
  // that would each replay a datagram.
  private handlerRegistered = false;

  constructor(
    private api: LanBeaconApi,
    options: LanInviteSessionOptions = {},
  ) {
    this.tickMs = options.tickMs ?? EXPIRY_TICK_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.presence = createPresence({
      now: () => Date.now(),
      advertise: (payload, durationMs) => {
        this.queueAdvertise(payload, durationMs);
      },
      stopAdvertising: () => {
        this.queueStopAdvertising();
      },
      unicast: (payload, address, port) => {
        void this.api.lanBeaconUnicast(payload, address, port);
      },
      // These callbacks can fire from a receive() chain that started before
      // close() but resolves its crypto after close() has already returned
      // (close() itself only awaits the fake-instant IPC calls, not any
      // in-flight presence.receive()). Gating the write itself — not just the
      // callback's entry point — is what stops that write from landing on a
      // session the dialog has already torn down.
      onInvite: (invite) => {
        if (!this.listening) return;
        // Whatever is already on screen is what the user is about to act on;
        // a later arrival must not redraw the group name under their cursor.
        if (get(this.receivedInvite) !== undefined) return;
        this.clearRequestTimer();
        this.requesting.set(undefined);
        this.receivedInvite.set(invite);
      },
      onChange: () => {
        if (this.listening) {
          this.intents.set(this.presence.heardIntents());
          this.offers.set(this.presence.heardOffers());
        }
      },
    });
  }

  /**
   * Starts listening. Throws if the main process is not ready to serve the
   * beacon channels yet — which happens on the very first launch, where the
   * window can be on screen before those handlers are registered — and leaves
   * the session closed so the caller can simply try again.
   */
  async open(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    if (!this.handlerRegistered) {
      this.handlerRegistered = true;
      this.api.onLanBeaconDatagram((_e, payload) => {
        if (!this.listening) return;
        void this.presence.receive(payload.bytes, payload.address, payload.port);
      });
    }
    try {
      await this.api.lanBeaconSetListening(true);
    } catch (e) {
      this.listening = false;
      throw e;
    }
    // Announce that a pane is open here. This keeps the radio awake and draws
    // unicast answers from anyone holding an offer or an intent — the only
    // reliable way to hear them when Wi-Fi power saving is dropping the
    // multicast beacons. It is cleared when the socket itself closes, so a
    // second pane closing does not silence the one still listening.
    await this.api.lanBeaconSetHello(
      encodeMessage({ v: LAN_INVITE_PROTOCOL_VERSION, kind: 'hello' }),
    );
    this.tick = setInterval(() => {
      this.presence.expire();
      this.intents.set(this.presence.heardIntents());
      this.offers.set(this.presence.heardOffers());
      this.syncAdvertisedWindows();
      this.checkAdvertisementOwnership();
    }, this.tickMs);
  }

  /**
   * A window that has run out in the engine is no longer sealing anything to
   * anybody, so the pane must stop saying it is: the name a newcomer is
   * announcing, and the countdown a member is watching, both come off with it.
   */
  private syncAdvertisedWindows(): void {
    // Written only on the transition, so a tick with nothing to report does
    // not push a redundant value at every subscriber twice a second.
    if (!this.presence.intent()) {
      if (get(this.myName) !== undefined) this.myName.set(undefined);
      if (get(this.intending) !== undefined) this.intending.set(undefined);
    }
    if (!this.presence.offer() && get(this.offering) !== undefined) {
      this.offering.set(undefined);
    }
  }

  /** Stops this session's own advertisement, if it still holds the slot. */
  private async stopOwnAdvertisement(): Promise<void> {
    const id = this.advertisementId;
    this.advertisementId = undefined;
    if (id !== undefined) await this.api.lanBeaconStopAdvertising(id);
  }

  private queueAdvertise(payload: Uint8Array, durationMs: number): void {
    this.advertisementQueue = this.advertisementQueue
      .then(async () => {
        this.advertisementId = await this.api.lanBeaconStartAdvertising(payload, durationMs);
        // close() cannot stop what did not exist yet when it ran, so a start
        // that lands after it has to take itself back off the wire.
        if (!this.listening) await this.stopOwnAdvertisement();
      })
      .catch((e) => console.error('Failed to start LAN beacon advertisement:', e));
  }

  private queueStopAdvertising(): void {
    this.advertisementQueue = this.advertisementQueue
      .then(() => this.stopOwnAdvertisement())
      .catch((e) => console.error('Failed to stop LAN beacon advertisement:', e));
  }

  /**
   * Another owner starting an advertisement takes the single slot away from
   * this one, and so does this one's own window running out in the main
   * process. Either way nothing of ours is going out any more, so the stores
   * the pane renders from have to say so.
   */
  private checkAdvertisementOwnership(): void {
    this.advertisementQueue = this.advertisementQueue
      .then(async () => {
        const mine = this.advertisementId;
        if (mine === undefined) return;
        const diagnostics = await this.api.lanBeaconDiagnostics();
        if (this.advertisementId !== mine || diagnostics.advertisementId === mine) return;
        this.advertisementId = undefined;
        this.presence.stopIntent();
        this.presence.stopOffer();
        this.myName.set(undefined);
        this.intending.set(undefined);
        this.offering.set(undefined);
      })
      .catch((e) => console.error('Failed to check LAN beacon advertisement ownership:', e));
  }

  async close(): Promise<void> {
    // Mirrors open()'s guard: flipping the flag before any await, not after,
    // is what makes a second close() call — sequential or fired without
    // awaiting the first — a no-op instead of a second release of this
    // session's claim on the shared beacon socket.
    if (!this.listening) return;
    this.listening = false;
    if (this.tick !== undefined) {
      clearInterval(this.tick);
      this.tick = undefined;
    }
    this.clearRequestTimer();
    this.presence.stopIntent();
    this.presence.stopOffer();
    // Only ever stops this session's own advertisement — a session that never
    // advertised must not silence whichever other owner currently holds the
    // one advertisement slot.
    await this.advertisementQueue;
    await this.api.lanBeaconSetListening(false);
    this.intents.set([]);
    this.receivedInvite.set(undefined);
    this.myName.set(undefined);
    this.intending.set(undefined);
    this.offers.set([]);
    this.offering.set(undefined);
    this.requesting.set(undefined);
  }

  async advertiseIntent(durationMs: number): Promise<string> {
    const name = await this.presence.advertiseIntent(durationMs);
    this.myName.set(name);
    this.intending.set({ until: Date.now() + durationMs });
    return name;
  }

  stopIntent(): void {
    this.presence.stopIntent();
    this.myName.set(undefined);
    this.intending.set(undefined);
  }

  /** Returns the sids actually sealed to, so a caller can tell success from a silent skip. */
  async admit(sids: readonly string[], inviteCode: string, groupName: string): Promise<string[]> {
    return this.presence.admit(sids, inviteCode, groupName);
  }

  async offerGroup(groupName: string, inviteCode: string, durationMs: number): Promise<void> {
    await this.presence.offerGroup(groupName, inviteCode, durationMs);
    this.offering.set({ until: Date.now() + durationMs });
  }

  stopOffer(): void {
    this.presence.stopOffer();
    this.offering.set(undefined);
  }

  private clearRequestTimer(): void {
    if (this.requestTimer !== undefined) {
      clearTimeout(this.requestTimer);
      this.requestTimer = undefined;
    }
  }

  async requestInvite(sid: string): Promise<void> {
    const sent = await this.presence.requestInvite(sid);
    // A refusal means the list itself already explains why (the offer is gone,
    // or two groups are showing the same name), so there is nothing to wait on.
    if (!sent || !this.listening) return;
    this.clearRequestTimer();
    this.requesting.set({ sid, state: 'pending' });
    this.requestTimer = setTimeout(() => {
      this.requestTimer = undefined;
      const current = get(this.requesting);
      if (current?.sid === sid && current.state === 'pending') {
        this.requesting.set({ sid, state: 'no-reply' });
      }
    }, this.requestTimeoutMs);
  }
}
