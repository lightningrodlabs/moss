import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackCommentWire, SyncIssue, SyncRequest, SyncResponse } from '@theweave/utils';
import { FeedbackRecordStore, type FeedbackRecord } from './recordStore';
import { reporterKeyFromSeed, type ReporterKey } from './reporterKey';
import type { FeedbackWorkerClient, WorkerResult } from './workerClient';
import {
  FEEDBACK_SYNC_INTERVAL_MS,
  startFeedbackSync,
  syncOnce,
  type FeedbackSyncDeps,
} from './sync';

const teamComment = (id: number, createdAt: number): FeedbackCommentWire => ({
  id,
  authorLogin: 'dev',
  authorAssociation: 'MEMBER',
  postedForReporter: false,
  body: `c${id}`,
  createdAt,
  updatedAt: createdAt,
  deleted: false,
});

const issue = (number: number, comments: FeedbackCommentWire[]): SyncIssue => ({
  number,
  state: 'open',
  title: 'Title',
  updatedAt: 500,
  comments,
});

type Sync = (req: SyncRequest) => Promise<WorkerResult<SyncResponse>>;

let dir: string;
let store: FeedbackRecordStore;
let key: ReporterKey;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-sync-'));
  store = new FeedbackRecordStore(dir);
  key = reporterKeyFromSeed(new Uint8Array(32).fill(5));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function saveRecord(over: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return store.save({
    text: 't',
    screenshot: 'data:image/png;base64,AAAA',
    mossVersion: '1',
    os: 'linux',
    timestamp: 1000,
    state: 'open',
    issueNumber: 7,
    createdVia: 'worker',
    ...over,
  });
}

function makeDeps(sync: Sync): {
  deps: FeedbackSyncDeps;
  sync: ReturnType<typeof vi.fn<Parameters<Sync>, ReturnType<Sync>>>;
  onUnreadChanged: ReturnType<typeof vi.fn<[number], void>>;
  onNewTeamReplies: ReturnType<typeof vi.fn<[number], void>>;
  setInterval: ReturnType<typeof vi.fn<[() => void, number], unknown>>;
  clearInterval: ReturnType<typeof vi.fn<[unknown], void>>;
} {
  const syncSpy = vi.fn(sync);
  const onUnreadChanged = vi.fn<[number], void>();
  const onNewTeamReplies = vi.fn<[number], void>();
  const setIntervalSpy = vi.fn<[() => void, number], unknown>(() => 'handle');
  const clearIntervalSpy = vi.fn<[unknown], void>();
  return {
    deps: {
      store,
      workerUrl: () => 'https://w',
      getReporterKey: async () => key,
      makeClient: () => ({ sync: syncSpy }) as unknown as FeedbackWorkerClient,
      scheduler: { setInterval: setIntervalSpy, clearInterval: clearIntervalSpy },
      onUnreadChanged,
      onNewTeamReplies,
    },
    sync: syncSpy,
    onUnreadChanged,
    onNewTeamReplies,
    setInterval: setIntervalSpy,
    clearInterval: clearIntervalSpy,
  };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(condition()).toBe(true);
}

describe('syncOnce', () => {
  it('skips with no-records when only local-only records exist', async () => {
    saveRecord({ state: 'local-only', issueNumber: undefined });
    const t = makeDeps(async () => ({ ok: true, value: { issues: [] } }));
    expect(await syncOnce(t.deps)).toEqual({ skipped: 'no-records' });
    expect(t.sync).not.toHaveBeenCalled();
  });

  it('asks for the newest 100 issues with their cursors', async () => {
    for (let i = 1; i <= 101; i++) {
      saveRecord({ timestamp: i, issueNumber: i, issueUpdatedAt: i * 2 });
    }
    const t = makeDeps(async () => ({ ok: true, value: { issues: [] } }));
    await syncOnce(t.deps);
    const asked = t.sync.mock.calls[0][0].issues;
    expect(asked).toHaveLength(100);
    expect(asked.map((i) => i.number)).not.toContain(1);
    expect(asked).toContainEqual({ number: 101, since: 202 });
  });

  it('passes the worker failure reason through as a skip', async () => {
    saveRecord();
    const t = makeDeps(async () => ({ ok: false, reason: 'unreachable' }));
    expect(await syncOnce(t.deps)).toEqual({ skipped: 'unreachable' });
  });

  it('merges and emits unread once for two identical results', async () => {
    const saved = saveRecord();
    const t = makeDeps(async () => ({
      ok: true,
      value: { issues: [issue(7, [teamComment(1, 100)])] },
    }));
    expect(await syncOnce(t.deps)).toEqual({ synced: 1, unread: 1 });
    expect(await syncOnce(t.deps)).toEqual({ synced: 1, unread: 1 });
    expect(store.get(saved.id)).toMatchObject({
      issueUpdatedAt: 500,
      title: 'Title',
      comments: [teamComment(1, 100)],
      screenshot: saved.screenshot,
    });
    expect(t.onUnreadChanged.mock.calls).toEqual([[1]]);
  });

  it('calls onNewTeamReplies with the increase when unread grows and not when it falls', async () => {
    const saved = saveRecord({ comments: [teamComment(1, 100)] });
    let comments = [teamComment(1, 100), teamComment(2, 200), teamComment(3, 300)];
    const t = makeDeps(async () => ({ ok: true, value: { issues: [issue(7, comments)] } }));
    await syncOnce(t.deps);
    expect(t.onNewTeamReplies.mock.calls).toEqual([[2]]);
    expect(t.onUnreadChanged.mock.calls).toEqual([[3]]);

    store.update(saved.id, { lastReadAt: 250 });
    comments = [teamComment(1, 100), teamComment(2, 200), teamComment(3, 300)];
    await syncOnce(t.deps);
    expect(t.onNewTeamReplies.mock.calls).toEqual([[2]]);
    expect(t.onUnreadChanged.mock.calls).toEqual([[3], [1]]);
  });

  it('does not re-notify unread comments that were already stored before the first sync', async () => {
    saveRecord({ comments: [teamComment(1, 100), teamComment(2, 200)] });
    const t = makeDeps(async () => ({
      ok: true,
      value: { issues: [issue(7, [teamComment(1, 100), teamComment(2, 200)])] },
    }));
    await syncOnce(t.deps);
    expect(t.onNewTeamReplies).not.toHaveBeenCalled();
    expect(t.onUnreadChanged).not.toHaveBeenCalled();
  });

  it('runs exactly one more sync after the running one for calls made mid-run', async () => {
    saveRecord();
    const events: string[] = [];
    const releases: Array<() => void> = [];
    const t = makeDeps(async () => {
      const n = releases.length + 1;
      events.push(`start ${n}`);
      await new Promise<void>((r) => releases.push(r));
      events.push(`end ${n}`);
      return { ok: true, value: { issues: [] } };
    });
    const first = syncOnce(t.deps);
    await until(() => releases.length === 1);
    const second = syncOnce(t.deps);
    const third = syncOnce(t.deps);
    expect(third).toBe(second);
    releases[0]();
    await first;
    await until(() => releases.length === 2);
    releases[1]();
    await second;
    expect(t.sync).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });
});

describe('startFeedbackSync', () => {
  it('registers the interval with 600,000 ms, syncs immediately and stops', async () => {
    saveRecord();
    const t = makeDeps(async () => ({ ok: true, value: { issues: [] } }));
    const handle = startFeedbackSync(t.deps);
    expect(FEEDBACK_SYNC_INTERVAL_MS).toBe(600_000);
    expect(t.setInterval).toHaveBeenCalledWith(expect.any(Function), 600_000);
    // The immediate sync is still in flight, so this queues one follow-up run.
    await handle.syncNow();
    expect(t.sync).toHaveBeenCalledTimes(2);
    handle.stop();
    expect(t.clearInterval).toHaveBeenCalledWith('handle');
  });
});
