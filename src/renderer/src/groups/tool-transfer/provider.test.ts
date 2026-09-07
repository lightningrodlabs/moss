import { describe, it, expect } from 'vitest';
import { AgentPubKey } from '@holochain/client';
import { ToolTransferManifest, ToolTransferMessage } from '@theweave/moss-types';
import { handleProviderMessage } from './provider';
import { ToolAssetReader, ToolTransferTransport } from './transport';

const requester = new Uint8Array([1, 2, 3]) as AgentPubKey;
const request = {
  happSha256: 'a'.repeat(64),
  uiSha256: 'b'.repeat(64),
  toolCompatibilityId: 'tool',
};
const manifest: ToolTransferManifest = {
  happ: { sha256: 'a'.repeat(64), size: 3 },
  ui: { sha256: 'b'.repeat(64), files: [{ path: 'index.html', size: 2, sha256: 'c'.repeat(64) }] },
  icon: 'icon',
  chunkSize: 4,
};

function fakes(reader: Partial<ToolAssetReader>) {
  const sent: Array<{ to: AgentPubKey; message: ToolTransferMessage }> = [];
  const transport: ToolTransferTransport = {
    send: async (to, message) => {
      sent.push({ to, message });
    },
    onMessage: () => () => {},
  };
  const fullReader: ToolAssetReader = {
    readManifest: async () => undefined,
    readChunk: async () => new Uint8Array(),
    ...reader,
  };
  return { sent, transport, reader: fullReader };
}

describe('handleProviderMessage', () => {
  it('answers a request with an offer when the assets exist', async () => {
    const { sent, transport, reader } = fakes({ readManifest: async () => manifest });
    await handleProviderMessage(
      { kind: 'request', requestId: 'r1', from: requester, ...request },
      transport,
      reader,
      4,
    );
    expect(sent).toEqual([{ to: requester, message: { kind: 'offer', requestId: 'r1', manifest } }]);
  });

  it('answers a request with unavailable when the assets are missing or reading fails', async () => {
    const missing = fakes({});
    await handleProviderMessage(
      { kind: 'request', requestId: 'r1', from: requester, ...request },
      missing.transport,
      missing.reader,
    );
    expect(missing.sent[0].message).toMatchObject({ kind: 'unavailable', requestId: 'r1' });

    const failing = fakes({
      readManifest: async () => {
        throw new Error('boom');
      },
    });
    await handleProviderMessage(
      { kind: 'request', requestId: 'r2', from: requester, ...request },
      failing.transport,
      failing.reader,
    );
    expect(failing.sent[0].message).toMatchObject({
      kind: 'unavailable',
      requestId: 'r2',
      reason: expect.stringContaining('boom'),
    });
  });

  it('answers a chunk request with the chunk bytes for the requested Tool', async () => {
    const bytes = new Uint8Array([9, 9]);
    const seen: Array<{ happSha256: string; index: number; chunkSize: number }> = [];
    const { sent, transport, reader } = fakes({
      readChunk: async (r, index, chunkSize) => {
        seen.push({ happSha256: r.happSha256, index, chunkSize });
        return bytes;
      },
    });
    await handleProviderMessage(
      { kind: 'chunk-request', requestId: 'r1', from: requester, index: 1, ...request },
      transport,
      reader,
      4,
    );
    expect(seen).toEqual([{ happSha256: request.happSha256, index: 1, chunkSize: 4 }]);
    expect(sent).toEqual([
      { to: requester, message: { kind: 'chunk', requestId: 'r1', index: 1, bytes } },
    ]);
  });

  it('stays silent on a failing chunk read and on requester-bound messages', async () => {
    const { sent, transport, reader } = fakes({
      readChunk: async () => {
        throw new Error('nope');
      },
    });
    await handleProviderMessage(
      { kind: 'chunk-request', requestId: 'r1', from: requester, index: 0, ...request },
      transport,
      reader,
    );
    await handleProviderMessage({ kind: 'offer', requestId: 'r1', manifest }, transport, reader);
    await handleProviderMessage(
      { kind: 'unavailable', requestId: 'r1', reason: 'x' },
      transport,
      reader,
    );
    await handleProviderMessage(
      { kind: 'chunk', requestId: 'r1', index: 0, bytes: new Uint8Array() },
      transport,
      reader,
    );
    expect(sent).toEqual([]);
  });
});
