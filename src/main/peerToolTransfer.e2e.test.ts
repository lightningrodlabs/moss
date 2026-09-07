import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AgentPubKey } from '@holochain/client';
import { ToolTransferMessage } from '@theweave/moss-types';
import {
  readToolAssetsChunk,
  readToolAssetsManifest,
  storeToolAssetsFromPeer,
  ToolAssetDirs,
} from './peerToolAssets';
import { handleProviderMessage } from '../renderer/src/groups/tool-transfer/provider';
import {
  requestToolFromPeers,
  RequesterEvent,
} from '../renderer/src/groups/tool-transfer/requester';
import {
  ToolAssetReader,
  ToolTransferTransport,
} from '../renderer/src/groups/tool-transfer/transport';

/**
 * Two members wired together in memory: the provider answers from real files
 * with the real main-process reader, the requester stores with the real
 * main-process writer. Only the Holochain signal hop and Electron IPC are
 * simulated, by delivering messages directly between the two transports.
 */

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const CHUNK = 1000;

const alice = new Uint8Array([1]) as AgentPubKey;
const bob = new Uint8Array([2]) as AgentPubKey;

const happ = Uint8Array.from({ length: 4321 }, (_, i) => (i * 13) % 256);
const HAPP = sha(happ);
const UI = 'e'.repeat(64);
const TOOL = 'example-tool';
const files: Record<string, Uint8Array> = {
  'index.html': new TextEncoder().encode('<!doctype html><html><body>hi</body></html>'),
  'assets/index-abc.js': Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) % 256),
  'assets/style.css': new TextEncoder().encode('body { margin: 0 }'),
  'weave.config.json': new TextEncoder().encode('{"name":"example"}'),
};
const request = { happSha256: HAPP, uiSha256: UI, toolCompatibilityId: TOOL };

let root: string;
let aliceDirs: ToolAssetDirs;
let bobDirs: ToolAssetDirs;

function dirsUnder(base: string): ToolAssetDirs {
  return {
    happsDir: path.join(base, 'happs'),
    uisDir: path.join(base, 'uis'),
    toolsDir: path.join(base, 'tools'),
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-transfer-e2e-'));
  aliceDirs = dirsUnder(path.join(root, 'alice'));
  bobDirs = dirsUnder(path.join(root, 'bob'));
  fs.mkdirSync(aliceDirs.happsDir, { recursive: true });
  fs.writeFileSync(path.join(aliceDirs.happsDir, `${HAPP}.happ`), happ);
  for (const [rel, bytes] of Object.entries(files)) {
    const p = path.join(aliceDirs.uisDir, UI, 'assets', rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
  }
  fs.mkdirSync(path.join(aliceDirs.toolsDir, TOOL), { recursive: true });
  fs.writeFileSync(path.join(aliceDirs.toolsDir, TOOL, 'icon'), 'data:image/png;base64,ICON');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Builds the two ends of a link; each `send` lands in the other end's listeners. */
function linkedTransports(): { aliceSide: ToolTransferTransport; bobSide: ToolTransferTransport } {
  const aliceListeners = new Set<(m: ToolTransferMessage) => void>();
  const bobListeners = new Set<(m: ToolTransferMessage) => void>();
  const deliver = (to: AgentPubKey, m: ToolTransferMessage) => {
    const targets = to === alice ? aliceListeners : bobListeners;
    setTimeout(() => [...targets].forEach((l) => l(m)), 0);
  };
  const make = (mine: Set<(m: ToolTransferMessage) => void>): ToolTransferTransport => ({
    send: async (to, m) => deliver(to, m),
    onMessage: (l) => {
      mine.add(l);
      return () => {
        mine.delete(l);
      };
    },
  });
  return { aliceSide: make(aliceListeners), bobSide: make(bobListeners) };
}

describe('peer tool transfer end to end', () => {
  it('moves a Tool from one member’s disk to another’s through the protocol', async () => {
    const { aliceSide, bobSide } = linkedTransports();
    const aliceReader: ToolAssetReader = {
      readManifest: (r, size) => readToolAssetsManifest(aliceDirs, r, size),
      readChunk: (r, i, size) => readToolAssetsChunk(aliceDirs, r, i, size),
    };
    // Alice's Moss: every incoming message is handed to the stateless provider.
    aliceSide.onMessage((m) => {
      void handleProviderMessage(m, aliceSide, aliceReader, CHUNK);
    });

    const events: RequesterEvent[] = [];
    const result = await requestToolFromPeers(
      bobSide,
      bob,
      [alice],
      request,
      (e) => events.push(e),
      { offerTimeoutMs: 2000, chunkTimeoutMs: 2000, chunkAttempts: 2, window: 3, chunkSize: CHUNK },
    );
    expect(result.peer).toBe(alice);
    expect(events.filter((e) => e.type === 'peer-failed')).toEqual([]);
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'progress' });
    if (last?.type === 'progress') expect(last.chunksDone).toBe(last.chunksTotal);

    await storeToolAssetsFromPeer(bobDirs, result.manifest, result.bytes, request);

    expect(fs.readFileSync(path.join(bobDirs.happsDir, `${HAPP}.happ`))).toEqual(Buffer.from(happ));
    for (const [rel, bytes] of Object.entries(files)) {
      expect(fs.readFileSync(path.join(bobDirs.uisDir, UI, 'assets', rel))).toEqual(
        Buffer.from(bytes),
      );
    }
    expect(fs.readFileSync(path.join(bobDirs.toolsDir, TOOL, 'icon'), 'utf-8')).toBe(
      'data:image/png;base64,ICON',
    );
    // Nothing beyond the canonical files exists on either side.
    expect(fs.readdirSync(path.join(bobDirs.uisDir, UI))).toEqual(['assets']);
    expect(fs.readdirSync(aliceDirs.happsDir)).toEqual([`${HAPP}.happ`]);
  });

  it('reports unavailable when the provider lacks the Tool', async () => {
    const { aliceSide, bobSide } = linkedTransports();
    const emptyReader: ToolAssetReader = {
      readManifest: (r, size) => readToolAssetsManifest(bobDirs, r, size),
      readChunk: (r, i, size) => readToolAssetsChunk(bobDirs, r, i, size),
    };
    aliceSide.onMessage((m) => {
      void handleProviderMessage(m, aliceSide, emptyReader, CHUNK);
    });
    const events: RequesterEvent[] = [];
    await expect(
      requestToolFromPeers(bobSide, bob, [alice], request, (e) => events.push(e), {
        offerTimeoutMs: 2000,
        chunkTimeoutMs: 2000,
        chunkAttempts: 1,
        window: 1,
        chunkSize: CHUNK,
      }),
    ).rejects.toThrow(/No peer/);
    expect(events.at(-1)).toMatchObject({
      type: 'peer-failed',
      error: expect.stringMatching(/declined/),
    });
  });
});
