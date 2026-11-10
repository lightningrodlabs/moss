import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CreateIssueRequest, CreateIssueResponse, FeedbackCommentWire } from '@theweave/utils';
import { FeedbackRecordStore } from './recordStore';
import { reporterKeyFromSeed, type ReporterKey } from './reporterKey';
import type { FeedbackWorkerClient, WorkerResult } from './workerClient';
import { feedbackThreadSync, type FeedbackSyncDeps, type FeedbackThreadSync } from './sync';
import {
  feedbackSubmit,
  registerFeedbackIpc,
  type FeedbackIpcDeps,
  type FeedbackSubmitInput,
} from './ipc';

const input: FeedbackSubmitInput = {
  text: 'The sidebar flickers',
  screenshot: 'data:image/png;base64,AAAA',
  mossVersion: '0.16.0',
  os: 'linux',
  githubHandle: 'octocat',
};

type CreateIssue = (req: CreateIssueRequest) => Promise<WorkerResult<CreateIssueResponse>>;

function fakeClient(createIssue: CreateIssue): {
  makeClient: (url: string, key: ReporterKey) => FeedbackWorkerClient;
  createIssue: Mock<Parameters<CreateIssue>, ReturnType<CreateIssue>>;
} {
  const spy = vi.fn(createIssue);
  return {
    makeClient: () => ({ createIssue: spy }) as unknown as FeedbackWorkerClient,
    createIssue: spy,
  };
}

let dir: string;
let store: FeedbackRecordStore;
let key: ReporterKey;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-ipc-'));
  store = new FeedbackRecordStore(dir);
  key = reporterKeyFromSeed(new Uint8Array(32).fill(3));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('feedbackSubmit', () => {
  it('saves locally with reason no-reporter-key when there is no key', async () => {
    const client = fakeClient(async () => ({ ok: true, value: { issueNumber: 1, issueUrl: 'u' } }));
    const res = await feedbackSubmit(
      {
        store,
        workerUrl: () => 'https://w',
        getReporterKey: async () => undefined,
        makeClient: client.makeClient,
      },
      input,
    );
    expect(res.status).toBe('saved-locally');
    if (res.status !== 'saved-locally') return;
    expect(res.reason).toBe('no-reporter-key');
    expect(store.list()[0].state).toBe('local-only');
    expect(store.list()[0].reporterId).toBeUndefined();
    expect(client.createIssue).not.toHaveBeenCalled();
  });

  it('saves locally with reason no-worker-url when url is empty', async () => {
    const client = fakeClient(async () => ({ ok: true, value: { issueNumber: 1, issueUrl: 'u' } }));
    const res = await feedbackSubmit(
      {
        store,
        workerUrl: () => undefined,
        getReporterKey: async () => key,
        makeClient: client.makeClient,
      },
      input,
    );
    expect(res.status).toBe('saved-locally');
    if (res.status !== 'saved-locally') return;
    expect(res.reason).toBe('no-worker-url');
    expect(res.record.reporterId).toBe(key.reporterId);
    expect(store.list()[0].state).toBe('local-only');
    expect(client.createIssue).not.toHaveBeenCalled();
  });

  it('localOnly saves the record and never calls the client', async () => {
    const client = fakeClient(async () => ({ ok: true, value: { issueNumber: 1, issueUrl: 'u' } }));
    const res = await feedbackSubmit(
      {
        store,
        workerUrl: () => 'https://w',
        getReporterKey: async () => key,
        makeClient: client.makeClient,
      },
      { ...input, localOnly: true },
    );
    expect(res.status).toBe('saved-locally');
    if (res.status !== 'saved-locally') return;
    expect(res.reason).toBe('local-only');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].state).toBe('local-only');
    expect(store.list()[0].reporterId).toBe(key.reporterId);
    expect(client.createIssue).not.toHaveBeenCalled();
  });

  it('marks the record open with issue number and url on success', async () => {
    const issueUrl = 'https://github.com/o/r/issues/42';
    const client = fakeClient(async () => ({ ok: true, value: { issueNumber: 42, issueUrl } }));
    const res = await feedbackSubmit(
      {
        store,
        workerUrl: () => 'https://w',
        getReporterKey: async () => key,
        makeClient: client.makeClient,
      },
      input,
    );
    expect(res.status).toBe('created');
    expect(res.record).toMatchObject({
      issueNumber: 42,
      issueUrl,
      state: 'open',
      createdVia: 'worker',
      reporterId: key.reporterId,
    });
    expect(res.record).not.toHaveProperty('screenshot');
    expect(client.createIssue).toHaveBeenCalledWith({
      text: input.text,
      screenshot: input.screenshot,
      mossVersion: input.mossVersion,
      os: input.os,
      githubHandle: input.githubHandle,
    });
    const stored = store.get(res.record.id);
    expect(stored).toMatchObject({
      issueNumber: 42,
      issueUrl,
      state: 'open',
      createdVia: 'worker',
    });
    expect(stored?.screenshot).toBe(input.screenshot);
  });

  it('passes the client failure reason through and keeps the record local-only', async () => {
    const client = fakeClient(async () => ({ ok: false, reason: 'rate_limited', status: 429 }));
    const res = await feedbackSubmit(
      {
        store,
        workerUrl: () => 'https://w',
        getReporterKey: async () => key,
        makeClient: client.makeClient,
      },
      input,
    );
    expect(res.status).toBe('saved-locally');
    if (res.status !== 'saved-locally') return;
    expect(res.reason).toBe('rate_limited');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].state).toBe('local-only');
    expect(store.list()[0].issueUrl).toBeUndefined();
  });
});

describe('feedbackSubmit request validation', () => {
  async function submitText(text: string) {
    const client = fakeClient(async () => ({ ok: true, value: { issueNumber: 1, issueUrl: 'u' } }));
    const res = await feedbackSubmit(
      {
        store,
        workerUrl: () => 'https://w',
        getReporterKey: async () => key,
        makeClient: client.makeClient,
      },
      { ...input, text },
    );
    return { res, client };
  }

  it('refuses whitespace-only text without contacting the worker', async () => {
    const { res, client } = await submitText('   \n\t ');
    expect(res.status).toBe('saved-locally');
    if (res.status !== 'saved-locally') return;
    expect(res.reason).toBe('rejected');
    expect(store.list()[0].state).toBe('local-only');
    expect(client.createIssue).not.toHaveBeenCalled();
  });

  it('refuses text over 10,000 characters without contacting the worker', async () => {
    const { res, client } = await submitText('x'.repeat(10_001));
    expect(res.status).toBe('saved-locally');
    if (res.status !== 'saved-locally') return;
    expect(res.reason).toBe('rejected');
    expect(store.list()[0].state).toBe('local-only');
    expect(client.createIssue).not.toHaveBeenCalled();
  });
});

describe('registerFeedbackIpc', () => {
  function deps(): FeedbackIpcDeps & { sync: FeedbackThreadSync } {
    const base: FeedbackIpcDeps = {
      store,
      workerUrl: () => 'https://w',
      getReporterKey: async () => key,
    };
    return { ...base, sync: { syncNow: async () => {}, trackUnread: (change) => change() } };
  }

  it('registers exactly the feedback channels', () => {
    const handle = vi.fn();
    registerFeedbackIpc({ handle }, deps());
    expect(handle.mock.calls.map((c) => c[0]).sort()).toEqual([
      'feedback-get',
      'feedback-list',
      'feedback-mark-read',
      'feedback-reply',
      'feedback-reporter-status',
      'feedback-resolve',
      'feedback-submit',
      'feedback-sync-now',
      'feedback-unread-count',
    ]);
  });

  it('serves list, get and reporter status from the deps', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    });
    registerFeedbackIpc({ handle }, deps());
    const saved = store.save({ ...input, timestamp: 1000, state: 'local-only' });
    expect(await handlers.get('feedback-list')!({})).toHaveLength(1);
    expect(await handlers.get('feedback-get')!({}, saved.id)).toMatchObject({ id: saved.id });
    expect(await handlers.get('feedback-get')!({}, '../escape')).toBeUndefined();
    expect(await handlers.get('feedback-reporter-status')!({})).toEqual({
      reporterId: key.reporterId,
    });
  });
});

describe('feedback thread channels', () => {
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

  type Reply = FeedbackWorkerClient['reply'];
  type SyncFn = FeedbackWorkerClient['sync'];

  function setup(client: {
    reply?: Reply;
    resolve?: FeedbackWorkerClient['resolve'];
    sync?: SyncFn;
  }) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const handle = vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(channel, listener);
    });
    const makeClient = vi.fn(() => client as unknown as FeedbackWorkerClient);
    const onUnreadChanged = vi.fn<[number], void>();
    const syncDeps: FeedbackSyncDeps = {
      store,
      workerUrl: () => 'https://w',
      getReporterKey: async () => key,
      makeClient,
      scheduler: { setInterval: () => 0, clearInterval: () => {} },
      onUnreadChanged,
    };
    registerFeedbackIpc({ handle }, { ...syncDeps, sync: feedbackThreadSync(syncDeps) });
    return { handlers, makeClient, onUnreadChanged };
  }

  it('feedback-reply on a local-only record is not-filed without a client call', async () => {
    const reply = vi.fn<Parameters<Reply>, ReturnType<Reply>>();
    const t = setup({ reply });
    const saved = store.save({ ...input, timestamp: 1000, state: 'local-only' });
    expect(await t.handlers.get('feedback-reply')!({}, saved.id, 'hi')).toEqual({
      ok: false,
      reason: 'not-filed',
    });
    expect(await t.handlers.get('feedback-reply')!({}, '1-missing', 'hi')).toEqual({
      ok: false,
      reason: 'not-filed',
    });
    expect(reply).not.toHaveBeenCalled();
    expect(t.makeClient).not.toHaveBeenCalled();
  });

  it('feedback-reply refuses whitespace-only and over-long text without a client call', async () => {
    const reply = vi.fn<Parameters<Reply>, ReturnType<Reply>>();
    const t = setup({ reply });
    const saved = store.save({ ...input, timestamp: 1000, state: 'open', issueNumber: 7 });
    for (const text of ['  \n\t ', 'x'.repeat(10_001)]) {
      expect(await t.handlers.get('feedback-reply')!({}, saved.id, text)).toEqual({
        ok: false,
        reason: 'rejected',
      });
    }
    expect(reply).not.toHaveBeenCalled();
    expect(t.makeClient).not.toHaveBeenCalled();
  });

  it('feedback-reply posts, syncs and returns the refreshed record', async () => {
    const reply = vi.fn<Parameters<Reply>, ReturnType<Reply>>(async () => ({
      ok: true,
      value: { commentId: 9, createdAt: 100 },
    }));
    const sync = vi.fn<Parameters<SyncFn>, ReturnType<SyncFn>>(async () => ({
      ok: true,
      value: {
        issues: [
          { number: 7, state: 'open', title: 'T', updatedAt: 100, comments: [teamComment(9, 100)] },
        ],
      },
    }));
    const t = setup({ reply, sync });
    const saved = store.save({ ...input, timestamp: 1000, state: 'open', issueNumber: 7 });
    const res = await t.handlers.get('feedback-reply')!({}, saved.id, '  hi \n');
    expect(reply).toHaveBeenCalledWith(7, { text: 'hi' });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, record: { id: saved.id, title: 'T' } });
    expect(res).not.toHaveProperty('record.screenshot');
  });

  it('feedback-resolve passes a worker failure reason through', async () => {
    const resolve = vi.fn<
      Parameters<FeedbackWorkerClient['resolve']>,
      ReturnType<FeedbackWorkerClient['resolve']>
    >(async () => ({ ok: false, reason: 'conflict', status: 409 }));
    const t = setup({ resolve });
    const saved = store.save({ ...input, timestamp: 1000, state: 'open', issueNumber: 7 });
    expect(await t.handlers.get('feedback-resolve')!({}, saved.id)).toEqual({
      ok: false,
      reason: 'conflict',
    });
    expect(resolve).toHaveBeenCalledWith(7);
  });

  it('feedback-mark-read zeroes the record unread and emits', async () => {
    const t = setup({});
    const saved = store.save({
      ...input,
      timestamp: 1000,
      state: 'open',
      issueNumber: 7,
      comments: [teamComment(1, 100), teamComment(2, 200)],
    });
    expect(await t.handlers.get('feedback-unread-count')!({})).toBe(2);
    const summary = await t.handlers.get('feedback-mark-read')!({}, saved.id);
    expect(summary).toMatchObject({ id: saved.id });
    expect(summary).not.toHaveProperty('screenshot');
    expect(await t.handlers.get('feedback-unread-count')!({})).toBe(0);
    expect(t.onUnreadChanged.mock.calls).toEqual([[0]]);
  });

  it('feedback-sync-now returns the records and the unread total', async () => {
    const sync = vi.fn<Parameters<SyncFn>, ReturnType<SyncFn>>(async () => ({
      ok: true,
      value: {
        issues: [
          { number: 7, state: 'open', title: 'T', updatedAt: 100, comments: [teamComment(1, 100)] },
        ],
      },
    }));
    const t = setup({ sync });
    store.save({ ...input, timestamp: 1000, state: 'open', issueNumber: 7 });
    const res = await t.handlers.get('feedback-sync-now')!({});
    expect(res).toMatchObject({ unread: 1, records: [{ title: 'T' }] });
  });
});
