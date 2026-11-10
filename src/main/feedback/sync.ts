import { SYNC_MAX_ISSUES } from '@theweave/utils';
import { workerClientOrReason, type FeedbackIpcDeps } from './ipcDeps';
import { mergeSyncIssue, syncCursor, totalUnread } from './threadMerge';
import type { WorkerFailureReason } from './workerClient';

export type FeedbackSyncDeps = FeedbackIpcDeps & {
  scheduler: { setInterval(fn: () => void, ms: number): unknown; clearInterval(h: unknown): void };
  onUnreadChanged: (count: number) => void;
  /** Called with the increase when the unread total grows. */
  onNewTeamReplies?: (added: number) => void;
};

export type FeedbackSyncOutcome =
  | { synced: number; unread: number }
  | { skipped: 'no-records' | 'no-key' | 'no-worker-url' | WorkerFailureReason };

/** What the IPC handlers need from the sync loop. */
export type FeedbackThreadSync = {
  syncNow(): Promise<void>;
  /** Runs a change to the stored records and publishes the unread total if it moved. */
  trackUnread<T>(change: () => T): T;
};

export const FEEDBACK_SYNC_INTERVAL_MS = 600_000;

type SyncState = {
  /** The unread total the renderer was last told about. */
  lastUnread?: number;
  running?: Promise<FeedbackSyncOutcome>;
};

// Keyed by the deps object so every caller sharing one deps shares one
// unread baseline and one in-flight sync.
const states = new WeakMap<FeedbackSyncDeps, SyncState>();

function stateFor(deps: FeedbackSyncDeps): SyncState {
  let state = states.get(deps);
  if (!state) {
    state = {};
    states.set(deps, state);
  }
  return state;
}

/**
 * Takes the baseline from the stored records the first time, so unread
 * comments already on disk at startup are not announced again.
 */
function ensureBaseline(deps: FeedbackSyncDeps): SyncState {
  const state = stateFor(deps);
  if (state.lastUnread === undefined) state.lastUnread = totalUnread(deps.store.list());
  return state;
}

function publishUnread(deps: FeedbackSyncDeps): number {
  const state = ensureBaseline(deps);
  const unread = totalUnread(deps.store.list());
  const last = state.lastUnread ?? 0;
  if (unread !== last) {
    state.lastUnread = unread;
    deps.onUnreadChanged(unread);
    if (unread > last) deps.onNewTeamReplies?.(unread - last);
  }
  return unread;
}

async function runSync(deps: FeedbackSyncDeps): Promise<FeedbackSyncOutcome> {
  ensureBaseline(deps);
  const tracked = deps.store
    .list()
    .flatMap((record) => {
      const cursor = syncCursor(record);
      return cursor ? [{ id: record.id, timestamp: record.timestamp, cursor }] : [];
    })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, SYNC_MAX_ISSUES);
  if (tracked.length === 0) return { skipped: 'no-records' };

  const access = await workerClientOrReason(deps);
  if ('reason' in access) return { skipped: access.reason };
  const result = await access.client.sync({ issues: tracked.map((t) => t.cursor) });
  if (!result.ok) return { skipped: result.reason };

  let synced = 0;
  for (const issue of result.value.issues) {
    const match = tracked.find((t) => t.cursor.number === issue.number);
    // Read the record again after the network call so changes made meanwhile,
    // such as marking it read, are kept.
    const record = match && deps.store.get(match.id);
    if (!record) continue;
    const merged = mergeSyncIssue(record, issue);
    // An explicit undefined clears a reason the issue no longer carries.
    deps.store.update(record.id, { ...merged, stateReason: merged.stateReason });
    synced++;
  }
  return { synced, unread: publishUnread(deps) };
}

/** Pulls thread updates for the newest filed reports; overlapping calls share one run. */
export function syncOnce(deps: FeedbackSyncDeps): Promise<FeedbackSyncOutcome> {
  const state = stateFor(deps);
  if (state.running) return state.running;
  const running = runSync(deps).finally(() => {
    state.running = undefined;
  });
  state.running = running;
  return running;
}

function syncLogged(deps: FeedbackSyncDeps): Promise<void> {
  return syncOnce(deps).then(
    () => undefined,
    (e: unknown) => console.warn('Feedback sync failed:', e),
  );
}

export function feedbackThreadSync(deps: FeedbackSyncDeps): FeedbackThreadSync {
  return {
    syncNow: () => syncLogged(deps),
    trackUnread: <T>(change: () => T): T => {
      ensureBaseline(deps);
      const result = change();
      publishUnread(deps);
      return result;
    },
  };
}

export function startFeedbackSync(deps: FeedbackSyncDeps): {
  stop(): void;
  syncNow(): Promise<void>;
} {
  const handle = deps.scheduler.setInterval(() => {
    void syncLogged(deps);
  }, FEEDBACK_SYNC_INTERVAL_MS);
  void syncLogged(deps);
  return {
    stop: () => deps.scheduler.clearInterval(handle),
    syncNow: () => syncLogged(deps),
  };
}
