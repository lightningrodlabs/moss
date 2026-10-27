/**
 * How the host came to hold an applet iframe: `reported` when the iframe said
 * it was ready to answer messages, `assumed` when the host fell back to the
 * iframe it found in the DOM without that report.
 */
export type IframeReadiness = 'reported' | 'assumed';

/**
 * The error text for a host-to-applet request that got no reply in time. The
 * likely cause differs with readiness, so the text names the right one.
 */
export function hostTimeoutMessage(
  messageType: string,
  target: string,
  timeoutMs: number,
  readiness: IframeReadiness,
): string {
  const head = `postMessage '${messageType}' to ${target} timed out after ${timeoutMs}ms. `;
  return readiness === 'reported'
    ? head +
        "The iframe reported that it can answer messages, so the request most likely stalled inside the Tool's own handler."
    : head +
        'The iframe never reported that it was ready, so it most likely failed to load or is not an installed applet view.';
}
