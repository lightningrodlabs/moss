import { describe, it, expect } from 'vitest';
import { encode } from '@msgpack/msgpack';
import {
  decodeMessage,
  encodeMessage,
  LAN_INVITE_PROTOCOL_VERSION,
  MAX_DATAGRAM_BYTES,
  type GroupOffer,
  type InviteSealed,
  type Hello,
  type JoinIntent,
} from './protocol.js';

const KEY = new Uint8Array(65).fill(7);

const OFFER: GroupOffer = {
  v: LAN_INVITE_PROTOCOL_VERSION,
  kind: 'group-offer',
  sid: 'abc123',
  groupName: 'Team Standup',
  offerKey: KEY,
};

const INTENT: JoinIntent = {
  v: LAN_INVITE_PROTOCOL_VERSION,
  kind: 'join-intent',
  sid: 'def456',
  joinerKey: KEY,
};

const SEALED: InviteSealed = {
  v: LAN_INVITE_PROTOCOL_VERSION,
  kind: 'invite-sealed',
  sid: 'abc123',
  senderKey: KEY,
  nonce: new Uint8Array(12).fill(3),
  ciphertext: new Uint8Array(80).fill(4),
};

describe('encodeMessage / decodeMessage', () => {
  it('round-trips a group offer', () => {
    expect(decodeMessage(encodeMessage(OFFER))).toEqual(OFFER);
  });

  it('round-trips a join intent', () => {
    expect(decodeMessage(encodeMessage(INTENT))).toEqual(INTENT);
  });

  it('round-trips a sealed invite', () => {
    expect(decodeMessage(encodeMessage(SEALED))).toEqual(SEALED);
  });

  it('keeps a beacon well under the datagram budget', () => {
    expect(encodeMessage(OFFER).length).toBeLessThan(MAX_DATAGRAM_BYTES);
  });

  it('drops a datagram of a foreign protocol version', () => {
    const foreign = encode({ ...OFFER, v: 99 });
    expect(decodeMessage(foreign)).toBeUndefined();
  });

  it('drops a datagram with an unknown kind', () => {
    const unknown = encode({ ...OFFER, kind: 'something-else' });
    expect(decodeMessage(unknown)).toBeUndefined();
  });

  it('drops a datagram whose fields have the wrong types', () => {
    const wrong = encode({ ...OFFER, offerKey: 'not-bytes' });
    expect(decodeMessage(wrong)).toBeUndefined();
  });

  it('drops a datagram missing a required field', () => {
    const partial = encode({ v: LAN_INVITE_PROTOCOL_VERSION, kind: 'join-intent', sid: 'x' });
    expect(decodeMessage(partial)).toBeUndefined();
  });

  it('drops an oversize datagram without decoding it', () => {
    const huge = encodeMessage({ ...SEALED, ciphertext: new Uint8Array(MAX_DATAGRAM_BYTES) });
    expect(decodeMessage(huge)).toBeUndefined();
  });

  it('drops bytes that are not msgpack at all', () => {
    expect(decodeMessage(new Uint8Array([0xc1, 0xc1, 0xc1]))).toBeUndefined();
  });
});

const HELLO: Hello = { v: LAN_INVITE_PROTOCOL_VERSION, kind: 'hello' };

describe('hello', () => {
  it('round-trips, carrying nothing but its kind and version', () => {
    expect(decodeMessage(encodeMessage(HELLO))).toEqual(HELLO);
  });

  it('is tiny, since it goes out every few seconds from every open pane', () => {
    expect(encodeMessage(HELLO).length).toBeLessThan(32);
  });

  it('is rejected if someone hangs extra fields off it', () => {
    const extra = encode({ v: LAN_INVITE_PROTOCOL_VERSION, kind: 'hello', sid: 'x' });
    expect(decodeMessage(extra)).toBeUndefined();
  });
});
