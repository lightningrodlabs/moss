/**
 * Wraps an async function so that calls made while a run is in flight share
 * that run's outcome. A new run starts only once the previous one has settled.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined;
  return () => {
    if (!inFlight) {
      inFlight = fn().finally(() => {
        inFlight = undefined;
      });
    }
    return inFlight;
  };
}
