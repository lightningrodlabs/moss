/**
 * Replies to an applet iframe request with an error envelope, so the promise
 * on the applet side rejects with that message. A message without a reply port
 * is not a request, and gets no reply.
 */
export function replyWithError(ports: readonly MessagePort[], error: unknown): void {
  const port = ports[0];
  if (!port) return;
  port.postMessage({
    type: 'error',
    error: error instanceof Error ? error.message : String(error),
  });
}
