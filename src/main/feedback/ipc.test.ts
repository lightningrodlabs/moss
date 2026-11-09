import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CreateIssueRequest, CreateIssueResponse } from '@theweave/utils';
import { FeedbackRecordStore } from './recordStore';
import { deriveReporterKey, type ReporterKey } from './reporterKey';
import type { FeedbackWorkerClient, WorkerResult } from './workerClient';
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
  key = await deriveReporterKey(async () => new Uint8Array(64).fill(3));
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

describe('registerFeedbackIpc', () => {
  function deps(): FeedbackIpcDeps {
    return { store, workerUrl: () => 'https://w', getReporterKey: async () => key };
  }

  it('registers exactly the four channels', () => {
    const handle = vi.fn();
    registerFeedbackIpc({ handle }, deps());
    expect(handle.mock.calls.map((c) => c[0]).sort()).toEqual([
      'feedback-get',
      'feedback-list',
      'feedback-reporter-status',
      'feedback-submit',
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
