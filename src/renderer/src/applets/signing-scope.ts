/**
 * Runs an operation that changes an applet's set of cells (creating, enabling
 * or disabling a clone cell), then refreshes the main process's zome-call
 * signing scope before handing the result back. An applet typically calls into
 * a new clone cell straight away, and the signer only signs for cells it knows
 * belong to the calling applet.
 */
export async function withSigningScopeRefresh<T>(
  cellChange: () => Promise<T>,
  refreshSigningScope: () => Promise<void>,
): Promise<T> {
  const result = await cellChange();
  await refreshSigningScope();
  return result;
}
