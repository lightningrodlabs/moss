import { describe, expect, it, vi } from 'vitest';
import { encode } from '@msgpack/msgpack';
import {
  AppWebsocket,
  CapGrantInfo,
  CellId,
  DnaHash,
  AgentPubKey,
  Signal,
  SignalType,
} from '@holochain/client';
import {
  DirectPeerStatus,
  PEER_STATUS_GRANT_TAG,
  decodePeerStatus,
  encodePeerStatus,
  hasPeerStatusGrant,
} from './directPeerStatus.js';

const hash = (n: number): Uint8Array => new Uint8Array(39).fill(n);
const dna = hash(1) as DnaHash;
const otherDna = hash(2) as DnaHash;
const me = hash(3) as AgentPubKey;
const peer = hash(4) as AgentPubKey;

function grantInfo(tag: string, capability: CapGrantInfo['cap_grant']['capability']): CapGrantInfo {
  return {
    cap_grant: { tag, constraint: { type: 'unrestricted' }, capability },
    action_hash: hash(9),
    created_at: 0,
  } as unknown as CapGrantInfo;
}

describe('encode/decode', () => {
  it('round-trips a ping', () => {
    const p = { type: 'Ping', status: 'online', tz_utc_offset: 120 } as const;
    expect(decodePeerStatus(encodePeerStatus(p))).toEqual(p);
  });
  it('rejects garbage and unknown types', () => {
    expect(decodePeerStatus(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(decodePeerStatus(encode({ type: 'Hello', status: 'x' }))).toBeUndefined();
    expect(decodePeerStatus(encode({ type: 'Ping' }))).toBeUndefined();
    expect(
      decodePeerStatus(encode({ type: 'Ping', status: 'x', tz_utc_offset: 'y' })),
    ).toBeUndefined();
    expect(decodePeerStatus(encode(5))).toBeUndefined();
  });
  it('accepts a timezone offset of at most 14 hours in whole minutes', () => {
    const ping = (tz_utc_offset: number) =>
      decodePeerStatus(encode({ type: 'Ping', status: 'online', tz_utc_offset }));
    expect(ping(840)?.tz_utc_offset).toBe(840);
    expect(ping(-840)?.tz_utc_offset).toBe(-840);
    expect(ping(841)).toBeUndefined();
    expect(ping(1.5)).toBeUndefined();
  });
});

describe('hasPeerStatusGrant', () => {
  const cell: CellId = [dna, me];
  const direct = grantInfo(PEER_STATUS_GRANT_TAG, { type: 'direct_signal' });
  it('finds an existing grant by cell and tag', () => {
    expect(hasPeerStatusGrant([[[dna, me], [direct]]], cell, PEER_STATUS_GRANT_TAG)).toBe(true);
    expect(hasPeerStatusGrant([[[dna, me], [direct]]], cell, 'other')).toBe(false);
    expect(hasPeerStatusGrant([[[otherDna, me], [direct]]], cell, PEER_STATUS_GRANT_TAG)).toBe(
      false,
    );
    expect(hasPeerStatusGrant([[[dna, peer], [direct]]], cell, PEER_STATUS_GRANT_TAG)).toBe(false);
    const zome = grantInfo(PEER_STATUS_GRANT_TAG, {
      type: 'zome_call',
      value: { functions: { type: 'all' } },
    });
    expect(hasPeerStatusGrant([[cell, [zome]]], cell, PEER_STATUS_GRANT_TAG)).toBe(false);
    expect(hasPeerStatusGrant([], cell, PEER_STATUS_GRANT_TAG)).toBe(false);
  });
});

function fakeWs() {
  let cb: ((s: Signal) => void) | undefined;
  const unsub = vi.fn();
  const sendDirectSignal = vi.fn().mockResolvedValue(undefined);
  const ws = {
    on: (_: string, c: (s: Signal) => void) => {
      cb = c;
      return unsub;
    },
    sendDirectSignal,
  } as unknown as AppWebsocket;
  return { ws, emit: (s: Signal) => cb!(s), unsub, sendDirectSignal };
}

describe('DirectPeerStatus', () => {
  it('delivers decoded payloads from this dna only', () => {
    const { ws, emit, unsub } = fakeWs();
    const listener = vi.fn();
    const off = new DirectPeerStatus(ws, dna).onSignal(listener);
    const pong = { type: 'Pong', status: 'online' } as const;
    emit({
      type: SignalType.AppDirect,
      value: { cell_id: [otherDna, me], from_agent: peer, signal: encodePeerStatus(pong) },
    });
    emit({
      type: SignalType.App,
      value: { cell_id: [dna, me], zome_name: 'z', payload: pong },
    } as unknown as Signal);
    emit({
      type: SignalType.AppDirect,
      value: { cell_id: [dna, me], from_agent: peer, signal: new Uint8Array([1, 2, 3]) },
    });
    expect(listener).not.toHaveBeenCalled();
    emit({
      type: SignalType.AppDirect,
      value: { cell_id: [dna, me], from_agent: peer, signal: encodePeerStatus(pong) },
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(peer, pong);
    off();
    expect(unsub).toHaveBeenCalled();
  });

  it('send skips the conductor for an empty agent list', async () => {
    const { ws, sendDirectSignal } = fakeWs();
    await new DirectPeerStatus(ws, dna).send([], { type: 'Ping', status: 'online' });
    expect(sendDirectSignal).not.toHaveBeenCalled();
  });

  it('send encodes the payload and targets the dna', async () => {
    const { ws, sendDirectSignal } = fakeWs();
    const payload = { type: 'Ping', status: 'online', tz_utc_offset: 60 } as const;
    await new DirectPeerStatus(ws, dna).send([peer], payload);
    expect(sendDirectSignal).toHaveBeenCalledWith({
      dna_hash: dna,
      agents: [peer],
      signal: encodePeerStatus(payload),
    });
  });
});
