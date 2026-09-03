import { AgentPubKey } from '@holochain/client';
import { ToolTransferManifest, ToolTransferMessage, ToolTransferRequest } from '@theweave/moss-types';
import {
  streamLayout,
  TOOL_TRANSFER_CHUNK_SIZE,
  validateToolTransferManifest,
} from '@theweave/utils';
import { ToolTransferTransport } from './transport';

export type RequesterOptions = {
  offerTimeoutMs: number;
  chunkTimeoutMs: number;
  chunkAttempts: number;
  window: number;
  chunkSize: number;
};

export const DEFAULT_REQUESTER_OPTIONS: RequesterOptions = {
  offerTimeoutMs: 10_000,
  chunkTimeoutMs: 15_000,
  chunkAttempts: 3,
  window: 4,
  chunkSize: TOOL_TRANSFER_CHUNK_SIZE,
};

export type RequesterEvent =
  | { type: 'requesting'; peer: AgentPubKey }
  | { type: 'progress'; peer: AgentPubKey; chunksDone: number; chunksTotal: number }
  | { type: 'peer-failed'; peer: AgentPubKey; error: string };

export type ToolTransferResult = { manifest: ToolTransferManifest; bytes: Uint8Array };

type OfferOrUnavailable = Extract<ToolTransferMessage, { kind: 'offer' | 'unavailable' }>;
type Chunk = Extract<ToolTransferMessage, { kind: 'chunk' }>;

/**
 * Resolves with the first message `match` accepts, or rejects after
 * `timeoutMs`. Replies are matched on the requestId the requester chose at
 * random, so a straggler from an abandoned attempt or an unrelated transfer
 * is ignored.
 */
function waitFor<T extends ToolTransferMessage>(
  transport: ToolTransferTransport,
  match: (m: ToolTransferMessage) => m is T,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const unsub = transport.onMessage((m) => {
      if (!match(m)) return;
      clearTimeout(timer);
      unsub();
      resolve(m);
    });
  });
}

async function fetchChunk(
  transport: ToolTransferTransport,
  me: AgentPubKey,
  peer: AgentPubKey,
  requestId: string,
  request: ToolTransferRequest,
  index: number,
  options: RequesterOptions,
): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < options.chunkAttempts; attempt++) {
    // Listen before sending so a fast reply cannot slip past the listener.
    const reply = waitFor(
      transport,
      (m): m is Chunk => m.kind === 'chunk' && m.requestId === requestId && m.index === index,
      options.chunkTimeoutMs,
    );
    try {
      await transport.send(peer, { kind: 'chunk-request', requestId, from: me, index, ...request });
      return (await reply).bytes;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`Chunk ${index} failed after ${options.chunkAttempts} attempts: ${lastError}`);
}

export async function requestToolFromPeer(
  transport: ToolTransferTransport,
  me: AgentPubKey,
  peer: AgentPubKey,
  request: ToolTransferRequest,
  onEvent: (event: RequesterEvent) => void,
  options: RequesterOptions = DEFAULT_REQUESTER_OPTIONS,
): Promise<ToolTransferResult> {
  const requestId = crypto.randomUUID();
  onEvent({ type: 'requesting', peer });

  const answer = waitFor(
    transport,
    (m): m is OfferOrUnavailable =>
      (m.kind === 'offer' || m.kind === 'unavailable') && m.requestId === requestId,
    options.offerTimeoutMs,
  );
  await transport.send(peer, { kind: 'request', requestId, from: me, ...request });
  const reply = await answer;
  if (reply.kind === 'unavailable') throw new Error(`Peer declined: ${reply.reason}`);

  const manifest = reply.manifest;
  const problem = validateToolTransferManifest(manifest, request);
  if (problem) throw new Error(problem);
  if (manifest.chunkSize !== options.chunkSize) {
    throw new Error(`Peer offered chunk size ${manifest.chunkSize}, expected ${options.chunkSize}`);
  }

  const layout = streamLayout(manifest);
  const bytes = new Uint8Array(layout.totalSize);
  let done = 0;
  let next = 0;
  let failed = false;
  // Each worker pulls the next unclaimed chunk until the stream is complete,
  // which keeps `window` requests in flight without any per-chunk bookkeeping.
  const worker = async () => {
    while (next < layout.chunkCount && !failed) {
      const index = next++;
      try {
        const chunk = await fetchChunk(transport, me, peer, requestId, request, index, options);
        const expectedLength = Math.min(
          options.chunkSize,
          layout.totalSize - index * options.chunkSize,
        );
        if (chunk.length !== expectedLength) {
          throw new Error(`Chunk ${index} has ${chunk.length} bytes, expected ${expectedLength}`);
        }
        bytes.set(chunk, index * options.chunkSize);
        done++;
        onEvent({ type: 'progress', peer, chunksDone: done, chunksTotal: layout.chunkCount });
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.window) }, worker));
  return { manifest, bytes };
}

/**
 * Tries each peer in order until one serves the whole Tool. A peer that
 * declines, times out, or serves something inconsistent is reported and
 * skipped.
 */
export async function requestToolFromPeers(
  transport: ToolTransferTransport,
  me: AgentPubKey,
  peers: AgentPubKey[],
  request: ToolTransferRequest,
  onEvent: (event: RequesterEvent) => void,
  options: RequesterOptions = DEFAULT_REQUESTER_OPTIONS,
): Promise<ToolTransferResult & { peer: AgentPubKey }> {
  for (const peer of peers) {
    try {
      const result = await requestToolFromPeer(transport, me, peer, request, onEvent, options);
      return { ...result, peer };
    } catch (e) {
      onEvent({ type: 'peer-failed', peer, error: e instanceof Error ? e.message : String(e) });
    }
  }
  throw new Error('No peer could provide the Tool');
}
