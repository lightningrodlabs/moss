import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  reporterIdFromPubKey,
  type FeedbackErrorResponse,
  type ResolveResponse,
} from '../../../shared/utils/src/feedback/index.ts';
import { getComment, getIssue } from '../src/db';
import { resetInstallationTokenCache } from '../src/github';
import { resolveRoute } from '../src/routes/resolve';
import { makeTestReporter, type TestReporter } from './sign';
import {
  CLOSED_SEC,
  COMMENT_ID,
  NOW_MS,
  call,
  clearTables,
  count,
  fakeGitHub,
  repoCalls,
  signedPost,
  track,
} from './threadWrites';

const path = (n: number) => `/v1/issues/${n}/resolve`;

async function resolve(
  reporter: TestReporter,
  number: number,
  body: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const req = await signedPost(reporter, path(number), body);
  return call(req, resolveRoute({ fetchImpl, nowMs: () => NOW_MS }));
}

async function ownReporter(number: number, state: 'open' | 'closed' = 'open') {
  const reporter = await makeTestReporter();
  await track(await reporterIdFromPubKey(reporter.pubKey), reporter.pubKey, number, state);
  return reporter;
}

beforeEach(async () => {
  resetInstallationTokenCache();
  await clearTables();
});

describe('POST /v1/issues/:number/resolve', () => {
  it('comments, then closes the issue on GitHub, and records it closed', async () => {
    const reporter = await ownReporter(7);
    const gh = fakeGitHub();
    const res = await resolve(reporter, 7, '{}', gh.fetchImpl);

    expect(res.status).toBe(200);
    expect((await res.json()) as ResolveResponse).toEqual({
      state: 'closed',
      closedAt: CLOSED_SEC,
    });
    const writes = repoCalls(gh.calls);
    expect(writes.map((c) => c.method)).toEqual(['POST', 'PATCH']);
    expect(writes[0].url).toMatch(/\/issues\/7\/comments$/);
    expect(writes[0].body).toEqual({ body: 'Closed as resolved by the reporter from Moss' });
    expect(writes[1].url).toMatch(/\/issues\/7$/);
    expect(writes[1].body).toEqual({ state: 'closed', state_reason: 'completed' });

    expect(await getIssue(env.FEEDBACK_DB, 7)).toMatchObject({
      state: 'closed',
      stateReason: 'completed',
      updatedAt: CLOSED_SEC,
    });
    expect((await getComment(env.FEEDBACK_DB, COMMENT_ID))?.postedForReporter).toBe(true);
  });

  it('accepts an empty body', async () => {
    const reporter = await ownReporter(7);
    const res = await resolve(reporter, 7, '', fakeGitHub().fetchImpl);
    expect(res.status).toBe(200);
  });

  it('answers 409 for an already closed issue without calling GitHub', async () => {
    const reporter = await ownReporter(7, 'closed');
    const gh = fakeGitHub();
    const res = await resolve(reporter, 7, '{}', gh.fetchImpl);

    expect(res.status).toBe(409);
    expect(((await res.json()) as FeedbackErrorResponse).error).toBe('conflict');
    expect(gh.calls).toHaveLength(0);
  });

  it('answers 404 for another reporter issue without calling GitHub', async () => {
    await ownReporter(7);
    const stranger = await makeTestReporter();
    const gh = fakeGitHub();
    const res = await resolve(stranger, 7, '{}', gh.fetchImpl);

    expect(res.status).toBe(404);
    expect(gh.calls).toHaveLength(0);
  });

  it('answers 502 when the close fails after the comment posted, leaving D1 open', async () => {
    const reporter = await ownReporter(7);
    const gh = fakeGitHub({ close: 500 });
    const res = await resolve(reporter, 7, '{}', gh.fetchImpl);

    expect(res.status).toBe(502);
    expect(((await res.json()) as FeedbackErrorResponse).error).toBe('github_error');
    expect((await getIssue(env.FEEDBACK_DB, 7))?.state).toBe('open');
    expect(await count('comments')).toBe(0);
  });
});
