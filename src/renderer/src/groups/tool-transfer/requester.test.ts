import { describe, it, expect } from 'vitest';
import { AgentPubKey } from '@holochain/client';
import { ToolTransferManifest, ToolTransferMessage } from '@theweave/moss-types';
import { streamLayout } from '@theweave/utils';
import { requestToolFromPeers, RequesterEvent, RequesterOptions } from './requester';
import { ToolTransferTransport } from './transport';

const me = new Uint8Array([0]) as AgentPubKey;
const alice = new Uint8Array([1]) as AgentPubKey;
const bob = new Uint8Array([2]) as AgentPubKey;
const request = {
  happSha256: 'a'.repeat(64),
  uiSha256: 'b'.repeat(64),
  toolCompatibilityId: 'tool',
};
const manifest: ToolTransferManifest = {
  happ: { sha256: 'a'.repeat(64), size: 5 },
  ui: { sha256: 'b'.repeat(64), files: [{ path: 'index.html', size: 6, sha256: 'c'.repeat(64) }] },
  icon: 'icon',
  chunkSize: 4,
};
const stream = Uint8Array.from({ length: 11 }, (_, i) => i);
const fast: RequesterOptions = {
  offerTimeoutMs: 20,
  chunkTimeoutMs: 20,
  chunkAttempts: 2,
  window: 2,
  chunkSize: 4,
};

type FarSide = (
  to: AgentPubKey,
  m: ToolTransferMessage,
  reply: (r: ToolTransferMessage) => void,
) => void;

/** A transport whose far side is scripted per peer, delivering asynchronously. */
function scriptedTransport(behaviour: FarSide): ToolTransferTransport {
  const listeners = new Set<(m: ToolTransferMessage) => void>();
  return {
    send: async (to, m) => {
      setTimeout(() => behaviour(to, m, (r) => [...listeners].forEach((l) => l(r))), 0);
    },
    onMessage: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

const servesEverything: FarSide = (_to, m, reply) => {
  if (m.kind === 'request') reply({ kind: 'offer', requestId: m.requestId, manifest });
  if (m.kind === 'chunk-request') {
    const start = m.index * 4;
    reply({
      kind: 'chunk',
      requestId: m.requestId,
      index: m.index,
      bytes: stream.slice(start, start + 4),
    });
  }
};

describe('requestToolFromPeers', () => {
  it('downloads and reassembles from the first peer, reporting progress', async () => {
    const events: RequesterEvent[] = [];
    const result = await requestToolFromPeers(
      scriptedTransport(servesEverything),
      me,
      [alice],
      request,
      (e) => events.push(e),
      fast,
    );
    expect(result.peer).toBe(alice);
    expect(result.bytes).toEqual(stream);
    expect(result.manifest).toEqual(manifest);
    expect(events[0]).toEqual({ type: 'requesting', peer: alice });
    const progress = events.filter((e) => e.type === 'progress');
    expect(progress.length).toBe(streamLayout(manifest).chunkCount);
    expect(progress.at(-1)).toMatchObject({ chunksDone: 3, chunksTotal: 3 });
  });

  it('moves to the next peer when the first says unavailable', async () => {
    const events: RequesterEvent[] = [];
    const transport = scriptedTransport((to, m, reply) => {
      if (to === alice && m.kind === 'request') {
        reply({ kind: 'unavailable', requestId: m.requestId, reason: 'no' });
      }
      if (to === bob) servesEverything(to, m, reply);
    });
    const result = await requestToolFromPeers(
      transport,
      me,
      [alice, bob],
      request,
      (e) => events.push(e),
      fast,
    );
    expect(result.peer).toBe(bob);
    expect(events.filter((e) => e.type === 'peer-failed').map((e) => e.peer)).toEqual([alice]);
  });

  it('moves to the next peer when the first never answers', async () => {
    const silent = scriptedTransport((to, m, reply) => {
      if (to === bob) servesEverything(to, m, reply);
    });
    const result = await requestToolFromPeers(silent, me, [alice, bob], request, () => {}, fast);
    expect(result.peer).toBe(bob);
  });

  it('retries a dropped chunk', async () => {
    let dropped = 0;
    const flaky = scriptedTransport((to, m, reply) => {
      if (m.kind === 'chunk-request' && m.index === 1 && dropped < 1) {
        dropped++;
        return;
      }
      servesEverything(to, m, reply);
    });
    const r = await requestToolFromPeers(flaky, me, [alice], request, () => {}, fast);
    expect(r.bytes).toEqual(stream);
    expect(dropped).toBe(1);
  });

  it('gives up on a peer after repeated chunk loss', async () => {
    const alwaysDrops = scriptedTransport((to, m, reply) => {
      if (m.kind === 'chunk-request' && m.index === 1) return;
      servesEverything(to, m, reply);
    });
    const events: RequesterEvent[] = [];
    await expect(
      requestToolFromPeers(alwaysDrops, me, [alice], request, (e) => events.push(e), fast),
    ).rejects.toThrow(/No peer/);
    expect(events.at(-1)).toMatchObject({
      type: 'peer-failed',
      peer: alice,
      error: expect.stringMatching(/Chunk 1/),
    });
  });

  it('rejects an offer whose manifest does not match the request', async () => {
    const wrong = scriptedTransport((_to, m, reply) => {
      if (m.kind === 'request') {
        reply({
          kind: 'offer',
          requestId: m.requestId,
          manifest: { ...manifest, happ: { ...manifest.happ, sha256: 'f'.repeat(64) } },
        });
      }
    });
    const events: RequesterEvent[] = [];
    await expect(
      requestToolFromPeers(wrong, me, [alice], request, (e) => events.push(e), fast),
    ).rejects.toThrow(/No peer/);
    expect(events.find((e) => e.type === 'peer-failed')).toMatchObject({
      error: expect.stringMatching(/happ/),
    });
  });

  it('rejects a chunk of the wrong length', async () => {
    const short = scriptedTransport((to, m, reply) => {
      if (m.kind === 'chunk-request' && m.index === 0) {
        reply({ kind: 'chunk', requestId: m.requestId, index: 0, bytes: new Uint8Array(2) });
        return;
      }
      servesEverything(to, m, reply);
    });
    const events: RequesterEvent[] = [];
    await expect(
      requestToolFromPeers(short, me, [alice], request, (e) => events.push(e), fast),
    ).rejects.toThrow(/No peer/);
    expect(events.find((e) => e.type === 'peer-failed')).toMatchObject({
      error: expect.stringMatching(/expected 4/),
    });
  });

  it('ignores replies carrying a foreign requestId', async () => {
    const noisy = scriptedTransport((to, m, reply) => {
      reply({ kind: 'offer', requestId: 'someone-else', manifest });
      servesEverything(to, m, reply);
    });
    const r = await requestToolFromPeers(noisy, me, [alice], request, () => {}, fast);
    expect(r.bytes).toEqual(stream);
  });

  it('fails immediately with no peers', async () => {
    await expect(
      requestToolFromPeers(scriptedTransport(() => {}), me, [], request, () => {}, fast),
    ).rejects.toThrow(/No peer/);
  });
});
