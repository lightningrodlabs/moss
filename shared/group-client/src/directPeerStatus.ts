import { decode, encode } from '@msgpack/msgpack';
import {
  AgentPubKey,
  AppWebsocket,
  CapGrantInfo,
  CellId,
  DnaHash,
  SignalType,
  encodeHashToBase64,
} from '@holochain/client';

/** Tag of the direct-signal capability grant that lets peers send us peer status. */
export const PEER_STATUS_GRANT_TAG = 'moss-peer-status';

export type DirectPeerStatusPayload = {
  type: 'Ping' | 'Pong';
  status: string;
  tz_utc_offset?: number;
};

export function encodePeerStatus(p: DirectPeerStatusPayload): Uint8Array {
  return encode(p);
}

/** Real UTC offsets are whole minutes within 14 hours either side. */
function isValidUtcOffset(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 840;
}

/** Returns undefined unless the bytes hold a well-formed peer status payload. */
export function decodePeerStatus(bytes: Uint8Array): DirectPeerStatusPayload | undefined {
  let value: unknown;
  try {
    value = decode(bytes);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (v.type !== 'Ping' && v.type !== 'Pong') return undefined;
  if (typeof v.status !== 'string') return undefined;
  const tz = v.tz_utc_offset;
  if (tz !== undefined && !isValidUtcOffset(tz)) return undefined;
  const payload: DirectPeerStatusPayload = { type: v.type, status: v.status };
  if (tz !== undefined) payload.tz_utc_offset = tz;
  return payload;
}

const sameCell = (a: CellId, b: CellId): boolean =>
  encodeHashToBase64(a[0]) === encodeHashToBase64(b[0]) &&
  encodeHashToBase64(a[1]) === encodeHashToBase64(b[1]);

/** True when the non-revoked grants of `cellId` already include a direct-signal grant with `tag`. */
export function hasPeerStatusGrant(
  grants: Array<[CellId, CapGrantInfo[]]>,
  cellId: CellId,
  tag: string,
): boolean {
  return grants.some(
    ([cell, infos]) =>
      sameCell(cell, cellId) &&
      infos.some(
        (info) => info.cap_grant.capability.type === 'direct_signal' && info.cap_grant.tag === tag,
      ),
  );
}

/** Sends and receives peer status pings as direct signals, which skip wasm on both ends. */
export class DirectPeerStatus {
  constructor(
    private appWs: AppWebsocket,
    private dnaHash: DnaHash,
  ) {}

  async send(agents: AgentPubKey[], payload: DirectPeerStatusPayload): Promise<void> {
    if (agents.length === 0) return;
    await this.appWs.sendDirectSignal({
      dna_hash: this.dnaHash,
      agents,
      signal: encodePeerStatus(payload),
    });
  }

  onSignal(
    listener: (from: AgentPubKey, payload: DirectPeerStatusPayload) => void | Promise<void>,
  ): () => void {
    const myDna = encodeHashToBase64(this.dnaHash);
    return this.appWs.on('signal', (signal) => {
      if (signal.type !== SignalType.AppDirect) return;
      if (encodeHashToBase64(signal.value.cell_id[0]) !== myDna) return;
      const payload = decodePeerStatus(signal.value.signal);
      if (!payload) return;
      const from = signal.value.from_agent;
      (async () => listener(from, payload))().catch((e) =>
        console.warn('Peer status listener failed: ', e),
      );
    });
  }
}
