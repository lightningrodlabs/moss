import type { IpcMain } from 'electron';
import { validateReplyRequest } from '@theweave/utils';
import type { FeedbackActionResult, FeedbackSyncResult } from './ipc';
import { summarize, workerClientOrReason, type FeedbackIpcDeps } from './ipcDeps';
import type { FeedbackRecordSummary } from './recordStore';
import type { FeedbackThreadSync } from './sync';
import { totalUnread } from './threadMerge';
import type { FeedbackWorkerClient, WorkerResult } from './workerClient';

type ThreadIpcDeps = FeedbackIpcDeps & { sync: FeedbackThreadSync };

/**
 * Runs a reporter action against the record's issue, then syncs so the
 * returned record already shows the result.
 */
async function issueAction(
  deps: ThreadIpcDeps,
  id: string,
  act: (client: FeedbackWorkerClient, issueNumber: number) => Promise<WorkerResult<unknown>>,
): Promise<FeedbackActionResult> {
  const issueNumber = deps.store.get(id)?.issueNumber;
  if (issueNumber === undefined) return { ok: false, reason: 'not-filed' };
  const access = await workerClientOrReason(deps);
  if ('reason' in access) return { ok: false, reason: access.reason };
  const result = await act(access.client, issueNumber);
  if (!result.ok) return { ok: false, reason: result.reason };
  await deps.sync.syncNow();
  const record = deps.store.get(id);
  if (!record) return { ok: false, reason: 'not-filed' };
  return { ok: true, record: summarize(record) };
}

/** The issue-thread half of the feedback IPC surface; see `registerFeedbackIpc`. */
export function registerFeedbackThreadIpc(
  ipcMain: { handle: IpcMain['handle'] },
  deps: ThreadIpcDeps,
): void {
  ipcMain.handle('feedback-sync-now', async (): Promise<FeedbackSyncResult> => {
    await deps.sync.syncNow();
    const records = deps.store.list();
    return { records, unread: totalUnread(records) };
  });
  ipcMain.handle(
    'feedback-reply',
    async (_e, id: string, text: string): Promise<FeedbackActionResult> => {
      // The worker would refuse an invalid reply anyway; checking here spares a
      // signed request that counts against the reporter's rate limit.
      const request = validateReplyRequest({ text });
      if ('error' in request) return { ok: false, reason: 'rejected' };
      return issueAction(deps, id, (client, issueNumber) => client.reply(issueNumber, request));
    },
  );
  ipcMain.handle(
    'feedback-resolve',
    (_e, id: string): Promise<FeedbackActionResult> =>
      issueAction(deps, id, (client, issueNumber) => client.resolve(issueNumber)),
  );
  ipcMain.handle('feedback-mark-read', (_e, id: string): FeedbackRecordSummary | undefined => {
    const lastReadAt = Math.floor(Date.now() / 1000);
    const updated = deps.sync.trackUnread(() => deps.store.update(id, { lastReadAt }));
    return updated ? summarize(updated) : undefined;
  });
  ipcMain.handle('feedback-unread-count', (): number => totalUnread(deps.store.list()));
}
