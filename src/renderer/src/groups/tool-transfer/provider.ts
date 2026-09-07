import { ToolTransferMessage } from '@theweave/moss-types';
import { TOOL_TRANSFER_CHUNK_SIZE } from '@theweave/utils';
import { ToolAssetReader, ToolTransferTransport } from './transport';

/**
 * Answers transfer messages from other members using only what is on local
 * disk. The provider holds no state: every message carries enough to answer
 * it, so a Moss that restarts mid-transfer simply keeps answering.
 */
export async function handleProviderMessage(
  message: ToolTransferMessage,
  transport: ToolTransferTransport,
  reader: ToolAssetReader,
  chunkSize: number = TOOL_TRANSFER_CHUNK_SIZE,
): Promise<void> {
  switch (message.kind) {
    case 'request': {
      const { requestId, from, happSha256, uiSha256, toolCompatibilityId } = message;
      const request = { happSha256, uiSha256, toolCompatibilityId };
      try {
        const manifest = await reader.readManifest(request, chunkSize);
        if (manifest) {
          await transport.send(from, { kind: 'offer', requestId, manifest });
        } else {
          await transport.send(from, {
            kind: 'unavailable',
            requestId,
            reason: 'Tool assets not on disk',
          });
        }
      } catch (e) {
        await transport.send(from, {
          kind: 'unavailable',
          requestId,
          reason: `Failed to read Tool assets: ${e}`,
        });
      }
      return;
    }
    case 'chunk-request': {
      const { requestId, from, index, happSha256, uiSha256, toolCompatibilityId } = message;
      try {
        const bytes = await reader.readChunk(
          { happSha256, uiSha256, toolCompatibilityId },
          index,
          chunkSize,
        );
        await transport.send(from, { kind: 'chunk', requestId, index, bytes });
      } catch (e) {
        console.warn(
          `[tool-transfer] failed to serve chunk ${index} for request ${requestId}: ${e}`,
        );
      }
      return;
    }
    default:
      return;
  }
}
