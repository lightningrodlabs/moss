import type { IpcMain } from 'electron';
import { validateCreateIssueRequest } from '@theweave/utils';
import type { FeedbackRecord, FeedbackRecordStore, FeedbackRecordSummary } from './recordStore';
import type { ReporterKey } from './reporterKey';
import { FeedbackWorkerClient, type WorkerFailureReason } from './workerClient';

export type FeedbackSubmitInput = {
  text: string;
  screenshot: string;
  mossVersion: string;
  os: string;
  githubHandle?: string;
  /** Record the report without ever contacting the worker (the Copy button). */
  localOnly?: boolean;
};

export type FeedbackSaveReason =
  | 'local-only'
  | 'no-worker-url'
  | 'no-reporter-key'
  | WorkerFailureReason;

export type FeedbackSubmitResult =
  | { status: 'created'; record: FeedbackRecordSummary }
  | { status: 'saved-locally'; record: FeedbackRecordSummary; reason: FeedbackSaveReason };

export type FeedbackReporterStatus = { reporterId?: string };

export type FeedbackIpcDeps = {
  store: FeedbackRecordStore;
  workerUrl: () => string | undefined;
  getReporterKey: () => Promise<ReporterKey | undefined>;
  makeClient?: (url: string, key: ReporterKey) => FeedbackWorkerClient;
};

function summarize(record: FeedbackRecord): FeedbackRecordSummary {
  const { screenshot: _screenshot, ...summary } = record;
  return summary;
}

/** The key is absent while the profile has no group or the seed cannot be loaded. */
async function reporterKeyOrUndefined(deps: FeedbackIpcDeps): Promise<ReporterKey | undefined> {
  try {
    return await deps.getReporterKey();
  } catch (e) {
    console.warn('Could not derive the feedback reporter key:', e);
    return undefined;
  }
}

/**
 * Persists the report before anything else so it is never lost, then tries to
 * file it with the worker and records the resulting issue on success.
 */
export async function feedbackSubmit(
  deps: FeedbackIpcDeps,
  input: FeedbackSubmitInput,
): Promise<FeedbackSubmitResult> {
  const key = await reporterKeyOrUndefined(deps);
  const record = deps.store.save({
    text: input.text,
    screenshot: input.screenshot,
    mossVersion: input.mossVersion,
    os: input.os,
    timestamp: Date.now(),
    state: 'local-only',
    ...(input.githubHandle ? { githubHandle: input.githubHandle } : {}),
    ...(key ? { reporterId: key.reporterId } : {}),
  });
  const savedLocally = (reason: FeedbackSaveReason): FeedbackSubmitResult => ({
    status: 'saved-locally',
    record: summarize(record),
    reason,
  });

  if (input.localOnly) return savedLocally('local-only');
  const url = deps.workerUrl();
  if (!url) return savedLocally('no-worker-url');
  if (!key) return savedLocally('no-reporter-key');

  // The worker would refuse an invalid request anyway; checking here spares a
  // signed request that counts against the reporter's rate limit.
  const request = validateCreateIssueRequest({
    text: input.text,
    screenshot: input.screenshot,
    mossVersion: input.mossVersion,
    os: input.os,
    ...(input.githubHandle ? { githubHandle: input.githubHandle } : {}),
  });
  if ('error' in request) return savedLocally('rejected');
  const client = deps.makeClient ? deps.makeClient(url, key) : new FeedbackWorkerClient(url, key);
  const result = await client.createIssue(request);
  if (!result.ok) return savedLocally(result.reason);

  const updated =
    deps.store.update(record.id, {
      issueNumber: result.value.issueNumber,
      issueUrl: result.value.issueUrl,
      state: 'open',
      createdVia: 'worker',
    }) ?? record;
  return { status: 'created', record: summarize(updated) };
}

/**
 * The renderer↔main surface of feedback. The parameter is named `ipcMain` and
 * the channel names are string literals so `ipc-contract-drift.test.ts` pairs
 * them with the preload bridges.
 */
export function registerFeedbackIpc(
  ipcMain: { handle: IpcMain['handle'] },
  deps: FeedbackIpcDeps,
): void {
  ipcMain.handle('feedback-submit', (_e, input: FeedbackSubmitInput) =>
    feedbackSubmit(deps, input),
  );
  ipcMain.handle('feedback-list', (): FeedbackRecordSummary[] => deps.store.list());
  ipcMain.handle('feedback-get', (_e, id: string): FeedbackRecord | undefined =>
    deps.store.get(id),
  );
  ipcMain.handle('feedback-reporter-status', async (): Promise<FeedbackReporterStatus> => {
    const key = await reporterKeyOrUndefined(deps);
    return key ? { reporterId: key.reporterId } : {};
  });
}
