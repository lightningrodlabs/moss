import { AgentPubKey } from '@holochain/client';
import { ToolTransferManifest, ToolTransferMessage, ToolTransferRequest } from '@theweave/moss-types';

/** Point-to-point delivery of transfer messages between group members. */
export interface ToolTransferTransport {
  send(to: AgentPubKey, message: ToolTransferMessage): Promise<void>;
  onMessage(listener: (message: ToolTransferMessage) => void): () => void;
}

/** Access to the local copy of a Tool's assets, as the provider sees them. */
export interface ToolAssetReader {
  readManifest(
    request: ToolTransferRequest,
    chunkSize: number,
  ): Promise<ToolTransferManifest | undefined>;
  readChunk(request: ToolTransferRequest, index: number, chunkSize: number): Promise<Uint8Array>;
}
