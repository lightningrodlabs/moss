import { decode, encode } from '@msgpack/msgpack';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const LAN_INVITE_PROTOCOL_VERSION = 1;

/**
 * Kept well below the ~1500 byte ethernet MTU so a beacon is never fragmented:
 * a fragmented multicast datagram is far more likely to be dropped in transit.
 */
export const MAX_DATAGRAM_BYTES = 1200;

// typebox 0.33 cannot express "a Uint8Array" structurally (Type.Unsafe with an
// object schema throws "Unknown type" from Value.Check against a real
// Uint8Array), so byte-valued fields are widened here and enforced instead
// by isBytesShaped below.
// Every field declared TBytes must also be listed in isBytesShaped below —
// that list, not this schema, is what actually enforces Uint8Array.
const TBytes = Type.Any();
const TVersion = Type.Literal(LAN_INVITE_PROTOCOL_VERSION);
const TSid = Type.String({ minLength: 1, maxLength: 32 });

const TGroupOffer = Type.Object(
  {
    v: TVersion,
    kind: Type.Literal('group-offer'),
    sid: TSid,
    groupName: Type.String({ maxLength: 120 }),
    offerKey: TBytes,
  },
  { additionalProperties: false },
);

const TInviteRequest = Type.Object(
  {
    v: TVersion,
    kind: Type.Literal('invite-request'),
    sid: TSid,
    requesterKey: TBytes,
  },
  { additionalProperties: false },
);

const TJoinIntent = Type.Object(
  {
    v: TVersion,
    kind: Type.Literal('join-intent'),
    sid: TSid,
    joinerKey: TBytes,
  },
  { additionalProperties: false },
);

const TInviteSealed = Type.Object(
  {
    v: TVersion,
    kind: Type.Literal('invite-sealed'),
    sid: TSid,
    senderKey: TBytes,
    nonce: TBytes,
    ciphertext: TBytes,
  },
  { additionalProperties: false },
);

/**
 * "I have a pane open on this network." Carries nothing else: its whole job is
 * to keep this machine's radio awake and to invite a unicast answer from
 * anyone holding an offer or an intent. Wi-Fi power saving drops multicast and
 * broadcast to a dozing station but delivers unicast reliably, so a listener
 * that only ever listens is the one thing this protocol cannot afford.
 */
const THello = Type.Object(
  {
    v: TVersion,
    kind: Type.Literal('hello'),
  },
  { additionalProperties: false },
);

const TLanInviteMessage = Type.Union([
  THello,
  TGroupOffer,
  TInviteRequest,
  TJoinIntent,
  TInviteSealed,
]);

export type Hello = Static<typeof THello>;
export type GroupOffer = Static<typeof TGroupOffer> & { offerKey: Uint8Array };
export type InviteRequest = Static<typeof TInviteRequest> & { requesterKey: Uint8Array };
export type JoinIntent = Static<typeof TJoinIntent> & { joinerKey: Uint8Array };
export type InviteSealed = Static<typeof TInviteSealed> & {
  senderKey: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};
export type LanInviteMessage = Hello | GroupOffer | InviteRequest | JoinIntent | InviteSealed;

export function encodeMessage(message: LanInviteMessage): Uint8Array {
  return encode(message);
}

/**
 * Anything a hostile or merely mismatched host puts on the wire arrives here, so
 * every failure resolves to `undefined` rather than an exception: a listener
 * should be able to ignore rubbish without a guard at every call site.
 */
export function decodeMessage(bytes: Uint8Array): LanInviteMessage | undefined {
  if (bytes.length > MAX_DATAGRAM_BYTES) return undefined;
  let decoded: unknown;
  try {
    decoded = decode(bytes);
  } catch {
    return undefined;
  }
  if (!isBytesShaped(decoded)) return undefined;
  if (!Value.Check(TLanInviteMessage, decoded)) return undefined;
  return decoded as LanInviteMessage;
}

/**
 * typebox cannot express "a Uint8Array" structurally, so the byte-valued
 * fields are checked here before the schema check runs on everything else.
 */
function isBytesShaped(decoded: unknown): boolean {
  if (typeof decoded !== 'object' || decoded === null) return false;
  const record = decoded as Record<string, unknown>;
  for (const field of [
    'offerKey',
    'requesterKey',
    'joinerKey',
    'senderKey',
    'nonce',
    'ciphertext',
  ]) {
    if (field in record && !(record[field] instanceof Uint8Array)) return false;
  }
  return true;
}
