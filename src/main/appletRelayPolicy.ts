// Deadline policy for requests relayed from a WAL window to the main
// renderer's applet host.

const RELAY_TIMEOUT_MS = 60_000;

/**
 * How long main waits for the main renderer to answer a relayed
 * request, or null for no deadline. A request whose handler blocks on a
 * modal native dialog cannot be given a deadline: the dialog always
 * resolves, and rejecting the caller first leaves the eventual answer
 * acting on behalf of nobody (an ASR session opened for a caller that
 * already gave up).
 */
export function relayTimeoutMs(requestType: string): number | null {
  return requestType === 'asr-open-session' ? null : RELAY_TIMEOUT_MS;
}
