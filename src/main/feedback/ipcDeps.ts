import type { FeedbackRecord, FeedbackRecordStore, FeedbackRecordSummary } from './recordStore';
import type { ReporterKey } from './reporterKey';
import { FeedbackWorkerClient } from './workerClient';

export type FeedbackIpcDeps = {
  store: FeedbackRecordStore;
  workerUrl: () => string | undefined;
  getReporterKey: () => Promise<ReporterKey | undefined>;
  makeClient?: (url: string, key: ReporterKey) => FeedbackWorkerClient;
};

export function summarize(record: FeedbackRecord): FeedbackRecordSummary {
  const { screenshot: _screenshot, ...summary } = record;
  return summary;
}

/** The key is absent only when the reporter seed cannot be loaded or created. */
export async function reporterKeyOrUndefined(
  deps: FeedbackIpcDeps,
): Promise<ReporterKey | undefined> {
  try {
    return await deps.getReporterKey();
  } catch (e) {
    console.warn('Could not derive the feedback reporter key:', e);
    return undefined;
  }
}

export function workerClientFor(
  deps: FeedbackIpcDeps,
  url: string,
  key: ReporterKey,
): FeedbackWorkerClient {
  return deps.makeClient ? deps.makeClient(url, key) : new FeedbackWorkerClient(url, key);
}

/** Resolves what a signed worker call needs, or the reason it cannot be made. */
export async function workerClientOrReason(
  deps: FeedbackIpcDeps,
): Promise<{ client: FeedbackWorkerClient } | { reason: 'no-key' | 'no-worker-url' }> {
  const key = await reporterKeyOrUndefined(deps);
  if (!key) return { reason: 'no-key' };
  const url = deps.workerUrl();
  if (!url) return { reason: 'no-worker-url' };
  return { client: workerClientFor(deps, url, key) };
}
