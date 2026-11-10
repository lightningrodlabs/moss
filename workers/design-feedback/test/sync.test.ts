import { createExecutionContext, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FEEDBACK_LIMITS,
  reporterIdFromPubKey,
  type SyncResponse,
} from '../../../shared/utils/src/feedback/index.ts';
import { getIssue, recordIssue, softDeleteComment, upsertComment } from '../src/db';
import { resetInstallationTokenCache } from '../src/github';
import { route } from '../src/router';
import { syncRoute } from '../src/routes/sync';
import { makeTestReporter, type TestReporter } from './sign';

const PATH = '/v1/sync';
const NOW_MS = 1_800_000_000_000;
const ISO_1 = '2026-11-10T10:00:00Z';
const ISO_2 = '2026-11-10T11:00:00Z';
const SEC_1 = Math.floor(Date.parse(ISO_1) / 1000);
const SEC_2 = Math.floor(Date.parse(ISO_2) / 1000);
const enc = new TextEncoder();
const db = env.FEEDBACK_DB;

type GitHubFixture = { issues: Record<number, { body: string; comments: unknown[] }> };
type Call = { url: string };

function marker(reporterId: string): string {
  return `<!-- moss-feedback reporter=${reporterId} -->`;
}

function ghComment(id: number, body: string, created: string, updated: string) {
  return {
    id,
    body,
    created_at: created,
    updated_at: updated,
    user: { login: 'alice' },
    author_association: 'MEMBER',
  };
}

/** Fake GitHub: serves token requests and the issues and comments in the fixture, 404 otherwise. */
function fakeGitHub(fixture: GitHubFixture = { issues: {} }): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    if (url.endsWith('/access_tokens')) {
      return Response.json(
        { token: 'tok', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
        { status: 201 },
      );
    }
    const m = /\/issues\/(\d+)(\/comments)?/.exec(url);
    const issue = m ? fixture.issues[Number(m[1])] : undefined;
    if (!m || !issue) return new Response('not found', { status: 404 });
    if (m[2]) return Response.json(issue.comments);
    return Response.json({
      number: Number(m[1]),
      state: 'closed',
      state_reason: 'completed',
      title: 'Hand filed',
      body: issue.body,
      created_at: ISO_1,
      updated_at: ISO_2,
      html_url: `https://github.com/o/r/issues/${m[1]}`,
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

let ipCounter = 0;

async function signedRequest(reporter: TestReporter, body: string): Promise<Request> {
  const headers = await reporter.sign({
    method: 'POST',
    path: PATH,
    body: enc.encode(body),
    nowSeconds: NOW_MS / 1000,
  });
  return new Request(`https://w${PATH}`, {
    method: 'POST',
    headers: { ...headers, 'CF-Connecting-IP': `10.1.0.${ipCounter}` },
    body,
  });
}

async function call(req: Request, fetchImpl: typeof fetch): Promise<Response> {
  const routes = [syncRoute({ fetchImpl, nowMs: () => NOW_MS })];
  return route(req, routes, env, createExecutionContext());
}

async function sync(
  reporter: TestReporter,
  issues: Array<{ number: number; since: number }>,
  fetchImpl: typeof fetch = fakeGitHub().fetchImpl,
): Promise<Response> {
  return call(await signedRequest(reporter, JSON.stringify({ issues })), fetchImpl);
}

async function track(reporterId: string, pubKey: Uint8Array, number: number): Promise<void> {
  await recordIssue(
    db,
    { reporterId, pubKey },
    { number, reporterId, title: 'Mine', createdAt: 100, createdVia: 'worker' },
  );
}

function comment(id: number, issueNumber: number, updatedAt: number, postedForReporter = false) {
  return {
    id,
    issueNumber,
    authorLogin: postedForReporter ? 'moss-app[bot]' : 'alice',
    authorAssociation: postedForReporter ? 'NONE' : 'MEMBER',
    postedForReporter,
    body: `comment ${id}`,
    createdAt: updatedAt,
    updatedAt,
  };
}

/** GitHub issue reads, one per backfill attempt that reached GitHub. */
function issueReads(calls: Call[]): number {
  return calls.filter((c) => /\/issues\/\d+$/.test(c.url)).length;
}

async function count(table: 'issues' | 'comments' | 'reporters'): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  resetInstallationTokenCache();
  ipCounter++;
  await db.batch([
    db.prepare('DELETE FROM comments'),
    db.prepare('DELETE FROM issues'),
    db.prepare('DELETE FROM reporters'),
  ]);
});

describe('POST /v1/sync', () => {
  it('returns an own issue with all comments when since is 0', async () => {
    const reporter = await makeTestReporter();
    const id = await reporterIdFromPubKey(reporter.pubKey);
    await track(id, reporter.pubKey, 7);
    await upsertComment(db, comment(1, 7, 200, true));
    await upsertComment(db, comment(2, 7, 300));

    const res = await sync(reporter, [{ number: 7, since: 0 }]);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issues: [
        {
          number: 7,
          state: 'open',
          title: 'Mine',
          updatedAt: 100,
          comments: [
            {
              id: 1,
              authorLogin: 'moss-app[bot]',
              authorAssociation: 'NONE',
              postedForReporter: true,
              body: 'comment 1',
              createdAt: 200,
              updatedAt: 200,
              deleted: false,
            },
            {
              id: 2,
              authorLogin: 'alice',
              authorAssociation: 'MEMBER',
              postedForReporter: false,
              body: 'comment 2',
              createdAt: 300,
              updatedAt: 300,
              deleted: false,
            },
          ],
        },
      ],
    } satisfies SyncResponse);
  });

  it('returns only comments updated after since', async () => {
    const reporter = await makeTestReporter();
    const id = await reporterIdFromPubKey(reporter.pubKey);
    await track(id, reporter.pubKey, 7);
    await upsertComment(db, comment(1, 7, 200));
    await upsertComment(db, comment(2, 7, 300));

    const res = await sync(reporter, [{ number: 7, since: 200 }]);
    const body = (await res.json()) as SyncResponse;

    expect(body.issues[0].comments.map((c) => c.id)).toEqual([2]);
  });

  it('sends a deleted comment flagged and without its old text', async () => {
    const reporter = await makeTestReporter();
    const id = await reporterIdFromPubKey(reporter.pubKey);
    await track(id, reporter.pubKey, 7);
    await upsertComment(db, comment(1, 7, 200));
    await softDeleteComment(db, 1, 400);

    const body = (await (await sync(reporter, [{ number: 7, since: 0 }])).json()) as SyncResponse;

    expect(body.issues[0].comments).toEqual([
      expect.objectContaining({ id: 1, deleted: true, body: '', updatedAt: 400 }),
    ]);
  });

  it('returns one entry for a number requested twice', async () => {
    const reporter = await makeTestReporter();
    const id = await reporterIdFromPubKey(reporter.pubKey);
    await track(id, reporter.pubKey, 7);

    const body = (await (
      await sync(reporter, [
        { number: 7, since: 0 },
        { number: 7, since: 0 },
      ])
    ).json()) as SyncResponse;

    expect(body.issues.map((i) => i.number)).toEqual([7]);
  });

  it("omits another reporter's issue and leaves D1 untouched", async () => {
    const owner = await makeTestReporter();
    const ownerId = await reporterIdFromPubKey(owner.pubKey);
    await track(ownerId, owner.pubKey, 7);
    await upsertComment(db, comment(1, 7, 200));
    const other = await makeTestReporter();
    const github = fakeGitHub();

    const res = await sync(other, [{ number: 7, since: 0 }], github.fetchImpl);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ issues: [] });
    expect(github.calls).toEqual([]);
    expect(await count('issues')).toBe(1);
    expect(await count('comments')).toBe(1);
    expect(await count('reporters')).toBe(1);
    expect((await getIssue(db, 7))?.reporterId).toBe(ownerId);
  });

  it('backfills an untracked issue carrying this reporter marker, with its comments', async () => {
    const reporter = await makeTestReporter();
    const id = await reporterIdFromPubKey(reporter.pubKey);
    const github = fakeGitHub({
      issues: {
        9: {
          body: `Hand filed\n${marker(id)}`,
          comments: [ghComment(50, 'first', ISO_1, ISO_1), ghComment(51, 'second', ISO_1, ISO_2)],
        },
      },
    });

    // since is ignored for a backfill: the client has never seen this thread.
    const res = await sync(reporter, [{ number: 9, since: SEC_2 }], github.fetchImpl);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      issues: [
        {
          number: 9,
          state: 'closed',
          stateReason: 'completed',
          title: 'Hand filed',
          updatedAt: SEC_2,
          comments: [
            {
              id: 50,
              authorLogin: 'alice',
              authorAssociation: 'MEMBER',
              postedForReporter: false,
              body: 'first',
              createdAt: SEC_1,
              updatedAt: SEC_1,
              deleted: false,
            },
            {
              id: 51,
              authorLogin: 'alice',
              authorAssociation: 'MEMBER',
              postedForReporter: false,
              body: 'second',
              createdAt: SEC_1,
              updatedAt: SEC_2,
              deleted: false,
            },
          ],
        },
      ],
    } satisfies SyncResponse);
    expect(await getIssue(db, 9)).toEqual({
      number: 9,
      reporterId: id,
      state: 'closed',
      stateReason: 'completed',
      title: 'Hand filed',
      createdAt: SEC_1,
      updatedAt: SEC_2,
      createdVia: 'github',
    });
    expect(await count('comments')).toBe(2);
    expect(await count('reporters')).toBe(1);
  });

  it('does not backfill an issue carrying another marker', async () => {
    const reporter = await makeTestReporter();
    const github = fakeGitHub({
      issues: { 9: { body: marker('someoneElse1'), comments: [ghComment(50, 'x', ISO_1, ISO_1)] } },
    });

    const res = await sync(reporter, [{ number: 9, since: 0 }], github.fetchImpl);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ issues: [] });
    expect(await count('issues')).toBe(0);
    expect(await count('comments')).toBe(0);
    expect(await count('reporters')).toBe(0);
  });

  it('skips a number GitHub cannot read and still returns the others', async () => {
    const reporter = await makeTestReporter();
    const id = await reporterIdFromPubKey(reporter.pubKey);
    await track(id, reporter.pubKey, 7);

    const body = (await (
      await sync(reporter, [
        { number: 404, since: 0 },
        { number: 7, since: 0 },
      ])
    ).json()) as SyncResponse;

    expect(body.issues.map((i) => i.number)).toEqual([7]);
    expect(await count('issues')).toBe(1);
  });

  it('skips a backfill that fails unexpectedly and still returns the others', async () => {
    const reporter = await makeTestReporter();
    const id = await reporterIdFromPubKey(reporter.pubKey);
    await track(id, reporter.pubKey, 7);
    const throwing = (async () => {
      throw new Error('Too many subrequests');
    }) as typeof fetch;

    const res = await sync(
      reporter,
      [
        { number: 9, since: 0 },
        { number: 7, since: 0 },
      ],
      throwing,
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as SyncResponse).issues.map((i) => i.number)).toEqual([7]);
  });

  it('attempts at most the per-request cap of backfills and still returns tracked issues', async () => {
    const reporter = await makeTestReporter();
    const id = await reporterIdFromPubKey(reporter.pubKey);
    await track(id, reporter.pubKey, 7);
    const cap = FEEDBACK_LIMITS.backfillsPerSyncRequest;
    const unknown = Array.from({ length: cap + 1 }, (_, i) => ({ number: 1000 + i, since: 0 }));
    const github = fakeGitHub();

    const res = await sync(reporter, [...unknown, { number: 7, since: 0 }], github.fetchImpl);

    expect(res.status).toBe(200);
    expect(((await res.json()) as SyncResponse).issues.map((i) => i.number)).toEqual([7]);
    expect(issueReads(github.calls)).toBe(cap);
  });

  it('skips backfill attempts beyond the hourly per-reporter limit without calling GitHub', async () => {
    const reporter = await makeTestReporter();
    const perRequest = FEEDBACK_LIMITS.backfillsPerSyncRequest;
    const hourly = FEEDBACK_LIMITS.backfillsPerReporterPerHour;
    let next = 1000;
    for (let r = 0; r < hourly / perRequest; r++) {
      const batch = Array.from({ length: perRequest }, () => ({ number: next++, since: 0 }));
      expect((await sync(reporter, batch)).status).toBe(200);
    }
    const github = fakeGitHub();

    const res = await sync(reporter, [{ number: next, since: 0 }], github.fetchImpl);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ issues: [] });
    expect(github.calls).toEqual([]);
  });

  it('rejects more than 100 numbers with 400', async () => {
    const reporter = await makeTestReporter();
    const issues = Array.from({ length: 101 }, (_, i) => ({ number: i + 1, since: 0 }));

    const res = await sync(reporter, issues);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request', message: expect.any(String) });
  });

  it('rejects a request whose body the signature does not cover with 401', async () => {
    const reporter = await makeTestReporter();
    const signed = await signedRequest(reporter, JSON.stringify({ issues: [] }));
    const req = new Request(signed, {
      body: JSON.stringify({ issues: [{ number: 1, since: 0 }] }),
    });

    const res = await call(req, fakeGitHub().fetchImpl);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_signature', message: expect.any(String) });
  });
});
