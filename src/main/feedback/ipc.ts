import type { IpcMain } from 'electron';
import { validateCreateIssueRequest } from '@theweave/utils';
import type { FeedbackRecord, FeedbackRecordSummary } from './recordStore';
import {
  reporterKeyOrUndefined,
  summarize,
  workerClientFor,
  type FeedbackIpcDeps,
} from './ipcDeps';
import type { FeedbackThreadSync } from './sync';
import { registerFeedbackThreadIpc } from './threadIpc';
import type { WorkerFailureReason } from './workerClient';

export type { FeedbackIpcDeps } from './ipcDeps';

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
  /** The reporter seed could not be loaded or created, so the request cannot be signed. */
  | 'no-reporter-key'
  | WorkerFailureReason;

export type FeedbackSubmitResult =
  | { status: 'created'; record: FeedbackRecordSummary }
  | { status: 'saved-locally'; record: FeedbackRecordSummary; reason: FeedbackSaveReason };

export type FeedbackReporterStatus = { reporterId?: string };

export type FeedbackActionResult =
  | { ok: true; record: FeedbackRecordSummary }
  | { ok: false; reason: 'no-key' | 'no-worker-url' | 'not-filed' | WorkerFailureReason };

export type FeedbackSyncResult = { records: FeedbackRecordSummary[]; unread: number };

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
  const client = workerClientFor(deps, url, key);
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
  deps: FeedbackIpcDeps & { sync: FeedbackThreadSync },
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
  registerFeedbackThreadIpc(ipcMain, deps);
}
