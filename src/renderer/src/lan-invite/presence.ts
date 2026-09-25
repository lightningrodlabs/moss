import { duplicateNames, nameFromPublicKey } from './naming.js';
import {
  decodeMessage,
  encodeMessage,
  LAN_INVITE_PROTOCOL_VERSION,
  type JoinIntent,
} from './protocol.js';
import { generateSessionKeys, open, seal, type SessionKeys } from './sealing.js';

/**
 * How long a heard entry survives without a beacon. Generous on purpose: Wi-Fi
 * drops multicast to a dozing radio often enough that a few misses in a row say
 * nothing about whether someone is still in the room, and a row that vanishes
 * and returns is worse than one that lingers a moment after they leave.
 */
export const HEARD_TTL_MS = 30_000;

/** A flooded network should cost a long list, not unbounded memory. */
export const MAX_HEARD = 50;

export type HeardIntent = { sid: string; name: string; ambiguous: boolean; lastSeen: number };
export type HeardOffer = { sid: string; groupName: string; ambiguous: boolean; lastSeen: number };

export type PresenceDeps = {
  now: () => number;
  advertise: (payload: Uint8Array, durationMs: number) => void;
  stopAdvertising: () => void;
  unicast: (payload: Uint8Array, address: string, port: number) => void;
  onInvite: (invite: { code: string; groupName: string }) => void;
  onChange: () => void;
};

export type Presence = {
  receive(bytes: Uint8Array, address: string, port: number): Promise<void>;
  advertiseIntent(durationMs: number): Promise<string>;
  stopIntent(): void;
  /** The intent window still open, if any — the pane's countdown reads this. */
  intent(): { until: number } | undefined;
  admit(sids: readonly string[], inviteCode: string, groupName: string): Promise<string[]>;
  heardIntents(): HeardIntent[];
  offerGroup(groupName: string, inviteCode: string, durationMs: number): Promise<void>;
  stopOffer(): void;
  /** Returns whether a request actually went out, so a caller can tell a send from a refusal. */
  requestInvite(sid: string): Promise<boolean>;
  heardOffers(): HeardOffer[];
  /** The offer window still open, if any — the pane's countdown reads this. */
  offer(): { until: number } | undefined;
  expire(): void;
};

type IntentRecord = {
  sid: string;
  joinerKey: Uint8Array;
  name: string;
  address: string;
  port: number;
  lastSeen: number;
};

type IntentSession = {
  sid: string;
  keys: SessionKeys;
  /** The window closes on its own, not only when `stopIntent()` is called explicitly. */
  deadline: number;
};

type OfferRecord = {
  sid: string;
  groupName: string;
  offerKey: Uint8Array;
  address: string;
  port: number;
  lastSeen: number;
};

type OfferSession = {
  sid: string;
  keys: SessionKeys;
  inviteCode: string;
  groupName: string;
  /** The window closes on its own, not only when `stopOffer()` is called explicitly. */
  deadline: number;
};
type RequestSession = { sid: string; keys: SessionKeys; offerKey: Uint8Array };

/** At most one unicast answer per asker in this window, so hellos cannot amplify. */
const REPLY_THROTTLE_MS = 2000;

export function createPresence(deps: PresenceDeps): Presence {
  const lastAnswered = new Map<string, number>();
  const heard = new Map<string, IntentRecord>();
  let intentSession: IntentSession | undefined;
  const offers = new Map<string, OfferRecord>();
  let offerSession: OfferSession | undefined;
  let requestSession: RequestSession | undefined;

  function changed(): void {
    deps.onChange();
  }

  function prune(): void {
    const cutoff = deps.now() - HEARD_TTL_MS;
    for (const [sid, record] of heard) {
      if (record.lastSeen <= cutoff) heard.delete(sid);
    }
    for (const [sid, offer] of offers) {
      if (offer.lastSeen <= cutoff) offers.delete(sid);
    }
    // The advertised window bounds who may be admitted, not merely who is shown
    // as advertising it — a captured sid+offerKey must stop working the moment
    // the window's own deadline passes, whether or not stopOffer() was called.
    if (offerSession && deps.now() >= offerSession.deadline) offerSession = undefined;
    // Same on the newcomer's side: once the window they announced has run out,
    // a sealed invite naming that sid is a replay, however long afterwards it
    // arrives, and must find nobody home.
    if (intentSession && deps.now() >= intentSession.deadline) intentSession = undefined;
  }

  /**
   * Which of our own sessions, if any, this sealed reply answers. A reply to a
   * request must come from the key the offer advertised: that is what stops a
   * bystander who saw the request racing a forged reply back.
   */
  function sessionFor(
    sid: string,
    senderKey: Uint8Array,
  ): { kind: 'intent' | 'request'; keys: SessionKeys } | undefined {
    if (intentSession && deps.now() >= intentSession.deadline) intentSession = undefined;
    if (intentSession?.sid === sid) return { kind: 'intent', keys: intentSession.keys };
    if (requestSession?.sid === sid && sameBytes(requestSession.offerKey, senderKey)) {
      return { kind: 'request', keys: requestSession.keys };
    }
    return undefined;
  }

  async function noteIntent(message: JoinIntent, address: string, port: number): Promise<void> {
    const existing = heard.get(message.sid);
    if (existing) {
      existing.lastSeen = deps.now();
      existing.address = address;
      existing.port = port;
      return;
    }
    prune();
    if (heard.size >= MAX_HEARD) return;
    heard.set(message.sid, {
      sid: message.sid,
      joinerKey: message.joinerKey,
      name: await nameFromPublicKey(message.joinerKey),
      address,
      port,
      lastSeen: deps.now(),
    });
    changed();
  }

  /**
   * Tell a machine that has just announced itself what we are holding, by
   * unicast. This is what makes the exchange work on a network where the other
   * side's radio is dozing: it will drop our multicast beacon and take this.
   */
  function answerHello(address: string, port: number): void {
    const now = deps.now();
    const previous = lastAnswered.get(address);
    if (previous !== undefined && now - previous < REPLY_THROTTLE_MS) return;
    lastAnswered.set(address, now);

    if (offerSession && now < offerSession.deadline) {
      deps.unicast(
        encodeMessage({
          v: LAN_INVITE_PROTOCOL_VERSION,
          kind: 'group-offer',
          sid: offerSession.sid,
          groupName: offerSession.groupName,
          offerKey: offerSession.keys.publicKeyRaw,
        }),
        address,
        port,
      );
    }

    if (intentSession && now < intentSession.deadline) {
      deps.unicast(
        encodeMessage({
          v: LAN_INVITE_PROTOCOL_VERSION,
          kind: 'join-intent',
          sid: intentSession.sid,
          joinerKey: intentSession.keys.publicKeyRaw,
        }),
        address,
        port,
      );
    }
  }

  function ambiguousNames(): ReadonlySet<string> {
    return duplicateNames([...heard.values()].map((record) => record.name));
  }

  return {
    async receive(bytes, address, port) {
      const message = decodeMessage(bytes);
      if (!message) return;

      if (message.kind === 'hello') {
        answerHello(address, port);
        return;
      }
      if (message.kind === 'join-intent') {
        await noteIntent(message, address, port);
        return;
      }
      if (message.kind === 'group-offer') {
        const existing = offers.get(message.sid);
        if (existing) {
          existing.lastSeen = deps.now();
          existing.address = address;
          existing.port = port;
          return;
        }
        prune();
        if (offers.size >= MAX_HEARD) return;
        offers.set(message.sid, {
          sid: message.sid,
          groupName: message.groupName,
          offerKey: message.offerKey,
          address,
          port,
          lastSeen: deps.now(),
        });
        changed();
        return;
      }
      if (message.kind === 'invite-request') {
        // An open window means anyone on this network may join while it lasts —
        // but a captured request replayed after the deadline finds nobody home.
        if (offerSession && deps.now() >= offerSession.deadline) offerSession = undefined;
        if (!offerSession || offerSession.sid !== message.sid) return;
        const sealed = await seal(
          formatInvite(offerSession.inviteCode, offerSession.groupName),
          message.requesterKey,
          offerSession.keys,
        );
        deps.unicast(
          encodeMessage({
            v: LAN_INVITE_PROTOCOL_VERSION,
            kind: 'invite-sealed',
            sid: message.sid,
            senderKey: offerSession.keys.publicKeyRaw,
            nonce: sealed.nonce,
            ciphertext: sealed.ciphertext,
          }),
          address,
          port,
        );
        return;
      }
      if (message.kind === 'invite-sealed') {
        const answered = sessionFor(message.sid, message.senderKey);
        if (!answered) return;
        const plaintext = await open(
          { nonce: message.nonce, ciphertext: message.ciphertext },
          message.senderKey,
          answered.keys,
        );
        if (!plaintext) return;
        const invite = parseInvite(plaintext);
        if (!invite) return;
        // The exchange this session existed for is finished. Retiring it here
        // is what stops a second sealed message for the same sid — an
        // impostor's, arriving behind the real one — from swapping the group
        // name out from under someone about to press Join, and on the flow-B
        // side it is also what takes the newcomer's beacon off the air rather
        // than leaving it announcing behind the admitted panel.
        if (answered.kind === 'intent') {
          intentSession = undefined;
          deps.stopAdvertising();
        } else {
          requestSession = undefined;
        }
        deps.onInvite(invite);
        changed();
      }
    },

    async advertiseIntent(durationMs) {
      const keys = await generateSessionKeys();
      const sid = randomSid();
      intentSession = { sid, keys, deadline: deps.now() + durationMs };
      const beacon = encodeMessage({
        v: LAN_INVITE_PROTOCOL_VERSION,
        kind: 'join-intent',
        sid,
        joinerKey: keys.publicKeyRaw,
      });
      deps.advertise(beacon, durationMs);
      changed();
      return nameFromPublicKey(keys.publicKeyRaw);
    },

    stopIntent() {
      intentSession = undefined;
      deps.stopAdvertising();
      changed();
    },

    intent() {
      if (intentSession && deps.now() >= intentSession.deadline) intentSession = undefined;
      return intentSession ? { until: intentSession.deadline } : undefined;
    },

    async admit(sids, inviteCode, groupName) {
      const ambiguous = ambiguousNames();
      const admitted: string[] = [];
      for (const sid of sids) {
        const record = heard.get(sid);
        // A name two beacons share cannot identify a person, so it is never
        // sealed to. The list shows why.
        if (!record || ambiguous.has(record.name)) continue;
        const keys = await generateSessionKeys();
        const sealed = await seal(formatInvite(inviteCode, groupName), record.joinerKey, keys);
        deps.unicast(
          encodeMessage({
            v: LAN_INVITE_PROTOCOL_VERSION,
            kind: 'invite-sealed',
            sid: record.sid,
            senderKey: keys.publicKeyRaw,
            nonce: sealed.nonce,
            ciphertext: sealed.ciphertext,
          }),
          record.address,
          record.port,
        );
        admitted.push(sid);
      }
      return admitted;
    },

    heardIntents() {
      prune();
      const ambiguous = ambiguousNames();
      return [...heard.values()]
        .map((record) => ({
          sid: record.sid,
          name: record.name,
          ambiguous: ambiguous.has(record.name),
          lastSeen: record.lastSeen,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async offerGroup(groupName, inviteCode, durationMs) {
      const keys = await generateSessionKeys();
      const sid = randomSid();
      offerSession = { sid, keys, inviteCode, groupName, deadline: deps.now() + durationMs };
      deps.advertise(
        encodeMessage({
          v: LAN_INVITE_PROTOCOL_VERSION,
          kind: 'group-offer',
          sid,
          groupName,
          offerKey: keys.publicKeyRaw,
        }),
        durationMs,
      );
      changed();
    },

    stopOffer() {
      offerSession = undefined;
      deps.stopAdvertising();
      changed();
    },

    async requestInvite(sid) {
      const offer = offers.get(sid);
      if (!offer) return false;
      // A name two beacons share cannot identify a group, so it is never asked
      // for. admit() refuses the same way on the other side of the exchange;
      // this keeps the engine from depending on the list having drawn the
      // ambiguity before the click landed.
      const ambiguous = duplicateNames([...offers.values()].map((o) => o.groupName));
      if (ambiguous.has(offer.groupName)) return false;
      const keys = await generateSessionKeys();
      requestSession = { sid, keys, offerKey: offer.offerKey };
      deps.unicast(
        encodeMessage({
          v: LAN_INVITE_PROTOCOL_VERSION,
          kind: 'invite-request',
          sid,
          requesterKey: keys.publicKeyRaw,
        }),
        offer.address,
        offer.port,
      );
      return true;
    },

    offer() {
      if (offerSession && deps.now() >= offerSession.deadline) offerSession = undefined;
      return offerSession ? { until: offerSession.deadline } : undefined;
    },

    heardOffers() {
      prune();
      const ambiguous = duplicateNames([...offers.values()].map((o) => o.groupName));
      return [...offers.values()]
        .map((offer) => ({
          sid: offer.sid,
          groupName: offer.groupName,
          ambiguous: ambiguous.has(offer.groupName),
          lastSeen: offer.lastSeen,
        }))
        .sort((a, b) => a.groupName.localeCompare(b.groupName));
    },

    expire() {
      const before = heard.size + offers.size;
      prune();
      if (heard.size + offers.size !== before) changed();
    },
  };
}

function randomSid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The group name travels with the code so the recipient can see what they are joining. */
function formatInvite(code: string, groupName: string): string {
  return JSON.stringify({ code, groupName });
}

function parseInvite(plaintext: string): { code: string; groupName: string } | undefined {
  try {
    const parsed = JSON.parse(plaintext) as { code?: unknown; groupName?: unknown };
    if (typeof parsed.code !== 'string' || typeof parsed.groupName !== 'string') return undefined;
    return { code: parsed.code, groupName: parsed.groupName };
  } catch {
    return undefined;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
