import { IframeKind } from '@theweave/api';
import { DnaHash } from '@holochain/client';

/**
 * The `source` a WAL window stamps on a message it forwards to the main process
 * on behalf of an embedded iframe.
 *
 * The identity (`iframeKind`) MUST come from the iframe's origin, never from the
 * forwarded message — that is the trust boundary. This function only assembles
 * the source object from that already-derived identity, so it is a pure,
 * table-testable expression with no DOM coupling. `fallbackGroupHash` is the WAL
 * window's own group, used only when an applet iframe did not declare one.
 */
export function deriveWalMessageSource(
  iframeKind: IframeKind,
  subType: string,
  fallbackGroupHash: DnaHash,
): IframeKind {
  if (iframeKind.type === 'cross-group') {
    return {
      type: 'cross-group',
      toolCompatibilityId: iframeKind.toolCompatibilityId,
      subType,
    };
  }
  return {
    type: 'applet',
    appletHash: iframeKind.appletHash,
    groupHash: iframeKind.groupHash ?? fallbackGroupHash,
    subType,
  };
}
