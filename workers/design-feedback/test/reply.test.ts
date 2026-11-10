import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FEEDBACK_LIMITS,
  buildReplyBody,
  reporterIdFromPubKey,
  type FeedbackErrorResponse,
  type ReplyResponse,
} from '../../../shared/utils/src/feedback/index.ts';
import { getComment, getIssue } from '../src/db';
import { resetInstallationTokenCache } from '../src/github';
import { replyRoute } from '../src/routes/reply';
import { makeTestReporter, type TestReporter } from './sign';
import {
  COMMENT_ID,
  COMMENT_SEC,
  NOW_MS,
  call,
  clearTables,
  count,
  fakeGitHub,
  repoCalls,
  signedPost,
  track,
} from './threadWrites';

const path = (n: number) => `/v1/issues/${n}/comments`;

async function reply(
  reporter: TestReporter,
  number: number,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const req = await signedPost(reporter, path(number), JSON.stringify(body));
  return call(req, replyRoute({ fetchImpl, nowMs: () => NOW_MS }));
}

async function ownReporter(number: number): Promise<TestReporter> {
  const reporter = await makeTestReporter();
  await track(await reporterIdFromPubKey(reporter.pubKey), reporter.pubKey, number);
  return reporter;
}

beforeEach(async () => {
  resetInstallationTokenCache();
  await clearTables();
});

describe('POST /v1/issues/:number/comments', () => {
  it('posts the quoted reply as the app and records it as posted for the reporter', async () => {
    const reporter = await ownReporter(7);
    const gh = fakeGitHub();
    const res = await reply(reporter, 7, { text: '  thanks\nmore  ' }, gh.fetchImpl);

    expect(res.status).toBe(201);
    expect((await res.json()) as ReplyResponse).toEqual({
      commentId: COMMENT_ID,
      createdAt: COMMENT_SEC,
    });
    const writes = repoCalls(gh.calls);
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('POST');
    expect(writes[0].url).toMatch(/\/issues\/7\/comments$/);
    expect(writes[0].body).toEqual({ body: buildReplyBody('thanks\nmore') });

    const raw = await env.FEEDBACK_DB.prepare(
      'SELECT posted_for_reporter FROM comments WHERE id = ?',
    )
      .bind(COMMENT_ID)
      .first<{ posted_for_reporter: number }>();
    expect(raw?.posted_for_reporter).toBe(1);
    const stored = await getComment(env.FEEDBACK_DB, COMMENT_ID);
    expect(stored).toMatchObject({
      issueNumber: 7,
      authorLogin: 'moss-feedback[bot]',
      authorAssociation: 'NONE',
      body: buildReplyBody('thanks\nmore'),
      createdAt: COMMENT_SEC,
    });
    expect((await getIssue(env.FEEDBACK_DB, 7))?.updatedAt).toBe(COMMENT_SEC);
  });

  it('answers 404 for an issue filed by another reporter without calling GitHub', async () => {
    await ownReporter(7);
    const stranger = await makeTestReporter();
    const gh = fakeGitHub();
    const res = await reply(stranger, 7, { text: 'hi' }, gh.fetchImpl);

    expect(res.status).toBe(404);
    expect(((await res.json()) as FeedbackErrorResponse).error).toBe('not_found');
    expect(gh.calls).toHaveLength(0);
    expect(await count('comments')).toBe(0);
  });

  it('answers 404 for an issue D1 does not track', async () => {
    const reporter = await ownReporter(7);
    const gh = fakeGitHub();
    const res = await reply(reporter, 8, { text: 'hi' }, gh.fetchImpl);

    expect(res.status).toBe(404);
    expect(gh.calls).toHaveLength(0);
  });

  it('rejects whitespace-only text with 400', async () => {
    const reporter = await ownReporter(7);
    const gh = fakeGitHub();
    const res = await reply(reporter, 7, { text: ' \n\t ' }, gh.fetchImpl);

    expect(res.status).toBe(400);
    expect(((await res.json()) as FeedbackErrorResponse).error).toBe('bad_request');
    expect(gh.calls).toHaveLength(0);
  });

  it('rate limits the comment after the hourly allowance with Retry-After', async () => {
    const reporter = await ownReporter(7);
    const id = await reporterIdFromPubKey(reporter.pubKey);
    const window = Math.floor(NOW_MS / 1000 / 3600);
    await env.FEEDBACK_KV.put(
      `comments:${id}:${window}`,
      String(FEEDBACK_LIMITS.commentsPerReporterPerHour),
    );
    const gh = fakeGitHub();
    const res = await reply(reporter, 7, { text: 'one more' }, gh.fetchImpl);

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(gh.calls).toHaveLength(0);
  });

  it('answers 502 with a fixed message when GitHub fails and stores nothing', async () => {
    const reporter = await ownReporter(7);
    const gh = fakeGitHub({ comment: 500 });
    const res = await reply(reporter, 7, { text: 'hi' }, gh.fetchImpl);

    expect(res.status).toBe(502);
    const body = (await res.json()) as FeedbackErrorResponse;
    expect(body.error).toBe('github_error');
    expect(body.message).not.toContain('upstream');
    expect(await count('comments')).toBe(0);
  });
});
