import { AgentPubKey } from '@holochain/client';
import { GroupClient } from '@theweave/group-client';
import { ToolTransferMessage, ToolTransferRequest } from '@theweave/moss-types';
import { handleProviderMessage } from './provider';
import { ToolAssetReader, ToolTransferTransport } from './transport';

/**
 * Bridges the transfer protocol onto the group's arbitrary remote-signal
 * channel. Incoming messages fan out to whoever is waiting (a requester) and
 * to the stateless provider, which answers requests from local disk.
 */
export class GroupToolTransferTransport implements ToolTransferTransport {
  private listeners = new Set<(message: ToolTransferMessage) => void>();

  private reader: ToolAssetReader = {
    readManifest: (request: ToolTransferRequest, chunkSize: number) =>
      window.electronAPI.readToolAssetsManifest(request, chunkSize),
    readChunk: (request: ToolTransferRequest, index: number, chunkSize: number) =>
      window.electronAPI.readToolAssetsChunk(request, index, chunkSize),
  };

  constructor(private groupClient: GroupClient) {}

  async send(to: AgentPubKey, message: ToolTransferMessage): Promise<void> {
    await this.groupClient.remoteSignalArbitrary({ type: 'tool-transfer', payload: message }, [to]);
  }

  onMessage(listener: (message: ToolTransferMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  receive(message: ToolTransferMessage): void {
    [...this.listeners].forEach((listener) => listener(message));
    handleProviderMessage(message, this, this.reader).catch((e) =>
      console.warn(`[tool-transfer] provider failed to handle ${message.kind}: ${e}`),
    );
  }
}
