import { PartialModifiers, WEAVE_PROTOCOL_VERSION } from '@theweave/moss-types';
import { decodeHashFromBase64, encodeHashToBase64 } from '@holochain/client';
import { decode, encode } from '@msgpack/msgpack';
import { Base64 } from 'js-base64';

/**
 * Why an invite link or invite code could not be turned into group modifiers.
 * Consumers map this to a localized, user facing message.
 */
export type InviteParseErrorReason =
  /** The input is not recognizable as a Weave invite link or invite code at all. */
  | 'wrong-format'
  /** The input is a valid invite, but for a Weave protocol version we cannot join. */
  | 'version-mismatch'
  /** The invite carries no or an unusable network seed. */
  | 'invalid-seed'
  /** The invite carries something that is not a valid agent key as progenitor. */
  | 'invalid-progenitor';

export class InviteParseError extends Error {
  readonly reason: InviteParseErrorReason;
  /** The Weave protocol version the invite was made for, if it could be determined. */
  readonly foundVersion?: string;

  constructor(reason: InviteParseErrorReason, message: string, foundVersion?: string) {
    super(message);
    this.name = 'InviteParseError';
    this.reason = reason;
    this.foundVersion = foundVersion;
  }
}

/**
 * Matches the weave scheme anywhere in a link, so that both the bare deep link
 * (`weave-0.16://invite/...`) and the web forwarding link
 * (`https://theweave.social/wal?weave-0.16://invite/...`) are covered.
 */
const WEAVE_LINK_REGEX = /weave-(\d+\.\d+):\/\/(\S+)/;

/**
 * The version alone, without requiring a payload, so that even a malformed weave URL
 * can be attributed to the Moss version that made it.
 */
const WEAVE_LINK_VERSION_REGEX = /weave-(\d+\.\d+):\/\//;

/** Matches a weave URL of any protocol version, for routing decisions. */
const WEAVE_URL_START_REGEX = /^weave-\d+\.\d+:\/\//;

/**
 * The progenitor as it appears in a link, stopping at the first character that cannot
 * be part of an agent key. Links get copied out of sentences, so trailing punctuation
 * must not be mistaken for part of the key. The literal `null` matches this too and is
 * recognized by parseProgenitor -- do not add it as an alternative here, or a key
 * beginning with those four characters would be truncated to an unstewarded group.
 */
const PROGENITOR_SEGMENT_REGEX = /^[A-Za-z0-9_-]+/;

/**
 * Whether a URL is a weave URL of any protocol version. Handlers use this rather than
 * the current version's prefix so that a link from another Moss version is still
 * intercepted and can be explained, instead of being left to fail as a navigation.
 */
export function isWeaveUrl(url: string): boolean {
  return WEAVE_URL_START_REGEX.test(url.trim());
}

/**
 * An invite code is a paste-only alternative to an invite link: `moss-<version>-<payload>`
 * where payload is url-safe base64 of a msgpack encoded {@link InviteCodePayload}. The
 * version sits outside the payload so that a code from another Moss version can be
 * recognized and reported even if its payload encoding differs.
 */
const INVITE_CODE_REGEX = /^moss-(\d+\.\d+)-([A-Za-z0-9_-]+)$/;

type InviteCodePayload = {
  /** network seed */
  s: string;
  /** progenitor agent key, raw bytes; null for an unstewarded group */
  p: Uint8Array | null;
};

const AGENT_KEY_PREFIX = 'uhCAk';
const AGENT_KEY_LENGTH = 39;

function assertValidSeed(networkSeed: unknown): asserts networkSeed is string {
  if (typeof networkSeed !== 'string' || networkSeed.length === 0) {
    throw new InviteParseError('invalid-seed', 'Invite contains no network seed.');
  }
}

/**
 * Validates a progenitor as it appears in an invite. `null` and the literal string
 * `'null'` both mean an unstewarded group.
 */
function parseProgenitor(progenitorString: string | null | undefined): string | null {
  if (progenitorString === undefined) {
    throw new InviteParseError('invalid-progenitor', 'Invite does not contain a progenitor.');
  }
  if (progenitorString === null || progenitorString === 'null') return null;
  let rawKey: Uint8Array;
  try {
    rawKey = decodeHashFromBase64(progenitorString);
  } catch (e) {
    throw new InviteParseError(
      'invalid-progenitor',
      `Progenitor key is not a valid agent key. Got ${progenitorString}`,
    );
  }
  if (rawKey.length !== AGENT_KEY_LENGTH || !progenitorString.startsWith(AGENT_KEY_PREFIX)) {
    throw new InviteParseError(
      'invalid-progenitor',
      `Progenitor key is not a valid agent key. Got ${progenitorString}`,
    );
  }
  return progenitorString;
}

/**
 * Parses the `<seed>&progenitor=<key>` part that follows `invite/` in a weave invite link.
 */
export function invitePropsToPartialModifiers(props: string): PartialModifiers {
  const [networkSeed, progenitorString] = props.split('&progenitor=');
  assertValidSeed(networkSeed);
  const progenitorSegment =
    progenitorString === undefined
      ? undefined
      : (progenitorString.match(PROGENITOR_SEGMENT_REGEX)?.[0] ?? progenitorString);
  return {
    networkSeed,
    progenitor: parseProgenitor(progenitorSegment),
  };
}

/**
 * The Weave protocol version a link was created for, or undefined if the input is not
 * a weave link. Lets callers reject links from an incompatible Moss version before
 * acting on them.
 */
export function weaveLinkVersion(link: string): string | undefined {
  return link.trim().match(WEAVE_LINK_VERSION_REGEX)?.[1];
}

/**
 * Whether a weave link addresses a group invite, as opposed to an asset, applet or
 * group. Callers use it to explain a link the running Moss version cannot open, since
 * only an invite can be re-requested from whoever sent it.
 */
export function isInviteLink(link: string): boolean {
  return link.trim().match(WEAVE_LINK_REGEX)?.[2].startsWith('invite/') ?? false;
}

export function partialModifiersFromInviteLink(inviteLink: string): PartialModifiers {
  const match = inviteLink.trim().match(WEAVE_LINK_REGEX);
  if (!match) {
    throw new InviteParseError('wrong-format', 'Input is not a Weave invite link.');
  }
  const [, version, rest] = match;
  if (version !== WEAVE_PROTOCOL_VERSION) {
    throw new InviteParseError(
      'version-mismatch',
      `Invite link is for Moss ${version} but this is Moss ${WEAVE_PROTOCOL_VERSION}.`,
      version,
    );
  }
  if (!rest.startsWith('invite/')) {
    throw new InviteParseError('wrong-format', 'Weave link is not an invite link.');
  }
  return invitePropsToPartialModifiers(rest.slice('invite/'.length));
}

/**
 * A paste-only invite that carries the same information as an invite link but is not
 * a URL, so it survives channels that mangle or block unknown link schemes.
 */
export function inviteCodeFromPartialModifiers(modifiers: PartialModifiers): string {
  assertValidSeed(modifiers.networkSeed);
  // Validate here rather than leaving the recipient to discover the problem.
  const progenitor = parseProgenitor(modifiers.progenitor);
  const payload: InviteCodePayload = {
    s: modifiers.networkSeed,
    p: progenitor ? decodeHashFromBase64(progenitor) : null,
  };
  return `moss-${WEAVE_PROTOCOL_VERSION}-${Base64.fromUint8Array(encode(payload), true)}`;
}

/** Whether the input has the shape of an invite code, regardless of its version. */
export function looksLikeInviteCode(input: string): boolean {
  return INVITE_CODE_REGEX.test(normalizeCode(input));
}

/** Codes are pasted, so tolerate wrapping whitespace introduced by chat clients. */
function normalizeCode(input: string): string {
  return input.replace(/\s/g, '');
}

export function partialModifiersFromInviteCode(inviteCode: string): PartialModifiers {
  const match = normalizeCode(inviteCode).match(INVITE_CODE_REGEX);
  if (!match) {
    throw new InviteParseError('wrong-format', 'Input is not a Weave invite code.');
  }
  const [, version, encoded] = match;
  if (version !== WEAVE_PROTOCOL_VERSION) {
    throw new InviteParseError(
      'version-mismatch',
      `Invite code is for Moss ${version} but this is Moss ${WEAVE_PROTOCOL_VERSION}.`,
      version,
    );
  }
  let payload: InviteCodePayload;
  try {
    payload = decode(Base64.toUint8Array(encoded)) as InviteCodePayload;
  } catch (e) {
    throw new InviteParseError('wrong-format', 'Invite code is damaged or incomplete.');
  }
  if (!payload || typeof payload !== 'object') {
    throw new InviteParseError('wrong-format', 'Invite code is damaged or incomplete.');
  }
  assertValidSeed(payload.s);
  // Keep every failure in this module an InviteParseError, so callers can map it to a
  // message instead of having to guard against raw decoding errors as well.
  if (payload.p != null && !(payload.p instanceof Uint8Array)) {
    throw new InviteParseError('invalid-progenitor', 'Invite code carries no usable progenitor.');
  }
  return {
    networkSeed: payload.s,
    progenitor: parseProgenitor(payload.p ? encodeHashToBase64(payload.p) : null),
  };
}

/**
 * Accepts either an invite link or an invite code, so that a single input field can
 * take whatever a user was given.
 */
export function partialModifiersFromInviteString(input: string): PartialModifiers {
  return looksLikeInviteCode(input)
    ? partialModifiersFromInviteCode(input)
    : partialModifiersFromInviteLink(input);
}
