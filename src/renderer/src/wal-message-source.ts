import { IframeKind } from '@theweave/api';
import { DnaHash, encodeHashToBase64 } from '@holochain/client';

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

export type WalZomeCallSigning =
  | { route: 'local'; callerAppletIds: string[] }
  | { route: 'relay' };

/**
 * Where a WAL window gets a zome call signed for an embedded iframe. An applet
 * iframe may sign for its own applet only, which the WAL window can do itself.
 * A cross-group view may sign for every applet of its tool, and only the main
 * window knows that set, so the request is relayed there.
 */
export function walZomeCallSigning(iframeKind: IframeKind): WalZomeCallSigning {
  if (iframeKind.type === 'cross-group') return { route: 'relay' };
  return { route: 'local', callerAppletIds: [encodeHashToBase64(iframeKind.appletHash)] };
}
