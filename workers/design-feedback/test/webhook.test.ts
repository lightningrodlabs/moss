import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { FEEDBACK_LIMITS } from '../../../shared/utils/src/feedback/index.ts';
import { getIssue, recordIssue, upsertComment } from '../src/db';
import { parseWebhookEvent, verifyWebhookSignature } from '../src/webhook';
import { hubSignature, postWebhook } from './webhookSign';

const db = env.FEEDBACK_DB;
const REPORTER = 'reporter1234';
const MARKER = `<!-- moss-feedback reporter=${REPORTER} -->`;
const ISO_1 = '2026-11-10T10:00:00Z';
const ISO_2 = '2026-11-10T11:00:00Z';
const SEC_1 = Math.floor(Date.parse(ISO_1) / 1000);
const SEC_2 = Math.floor(Date.parse(ISO_2) / 1000);

const repository = { full_name: 'o/r' };

type IssueOver = Partial<{
  number: number;
  state: string;
  state_reason: string | null;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
}>;

function issuePayload(number: number, over: IssueOver = {}) {
  return {
    number,
    state: 'open',
    state_reason: null,
    title: 'Mirrored title',
    body: `Some text\n${MARKER}`,
    created_at: ISO_1,
    updated_at: ISO_1,
    ...over,
  };
}

function commentPayload(id: number, over: Partial<{ body: string; updated_at: string }> = {}) {
  return {
    id,
    body: 'A reply',
    created_at: ISO_1,
    updated_at: ISO_2,
    user: { login: 'alice' },
    author_association: 'MEMBER',
    ...over,
  };
}

async function ensureReporter(): Promise<void> {
  await db
    .prepare(
      'INSERT INTO reporters (reporter_id, pubkey, created_at) VALUES (?, ?, 0) ON CONFLICT DO NOTHING',
    )
    .bind(REPORTER, new Uint8Array([1]))
    .run();
}

async function trackIssue(number: number): Promise<void> {
  await recordIssue(
    db,
    { reporterId: REPORTER, pubKey: new Uint8Array([1]) },
    { number, reporterId: REPORTER, title: 'T', createdAt: 100, createdVia: 'worker' },
  );
}

type CommentDb = {
  body: string;
  posted_for_reporter: number;
  deleted_at: number | null;
  updated_at: number;
};

function commentRow(id: number): Promise<CommentDb | null> {
  return db.prepare('SELECT * FROM comments WHERE id = ?').bind(id).first<CommentDb>();
}

async function issueCount(number: number): Promise<number> {
  const r = await db
    .prepare('SELECT COUNT(*) AS n FROM issues WHERE number = ?')
    .bind(number)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

describe('verifyWebhookSignature', () => {
  const body = new TextEncoder().encode('{"a":1}');

  it('accepts the GitHub signature and rejects anything else', async () => {
    const good = await hubSignature('s', '{"a":1}');
    expect(await verifyWebhookSignature('s', body, good)).toBe(true);
    expect(await verifyWebhookSignature('other', body, good)).toBe(false);
    expect(await verifyWebhookSignature('s', body, null)).toBe(false);
    expect(await verifyWebhookSignature('s', body, good.replace('sha256=', 'sha1='))).toBe(false);
    expect(await verifyWebhookSignature('s', body, good.slice(0, -2))).toBe(false);
    expect(await verifyWebhookSignature('s', body, 'sha256=zz')).toBe(false);
  });
});

describe('parseWebhookEvent', () => {
  it('ignores unknown events and rejects malformed or badly timed ones', () => {
    expect(parseWebhookEvent('ping', { zen: 'x' })).toEqual({ kind: 'ignored' });
    expect(parseWebhookEvent('issues', { action: 'opened' })).toBe('bad_request');
    expect(
      parseWebhookEvent('issues', {
        action: 'opened',
        issue: issuePayload(1, { created_at: 'yesterday' }),
      }),
    ).toBe('bad_request');
    expect(
      parseWebhookEvent('issue_comment', {
        action: 'created',
        issue: issuePayload(1),
        comment: { ...commentPayload(1), updated_at: 'never' },
      }),
    ).toBe('bad_request');
  });
});

describe('POST /v1/webhook', () => {
  it('rejects a bad or missing signature with 401 and stores nothing', async () => {
    await ensureReporter();
    const payload = { action: 'opened', issue: issuePayload(500), repository };
    const bad = await postWebhook('issues', payload, { secret: 'wrong' });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ error: 'invalid_signature' });
    const missing = await postWebhook('issues', payload, { signature: null });
    expect(missing.status).toBe(401);
    expect(await issueCount(500)).toBe(0);
  });

  it('answers 400 to a signed body that is not JSON', async () => {
    const body = 'not json';
    const res = await SELF.fetch('https://w/v1/webhook', {
      method: 'POST',
      headers: {
        'X-GitHub-Event': 'issues',
        'X-Hub-Signature-256': await hubSignature(env.WEBHOOK_SECRET, body),
      },
      body,
    });
    expect(res.status).toBe(400);
  });

  it('answers 413 to an oversized body', async () => {
    const res = await postWebhook('issues', {
      pad: 'x'.repeat(FEEDBACK_LIMITS.maxRequestBytes),
      repository,
    });
    expect(res.status).toBe(413);
  });

  it('ignores a delivery for another repository', async () => {
    await ensureReporter();
    const res = await postWebhook('issues', {
      action: 'opened',
      issue: issuePayload(501),
      repository: { full_name: 'someone/else' },
    });
    expect(res.status).toBe(204);
    expect(await issueCount(501)).toBe(0);
  });

  it('answers a ping with 204 and an empty body', async () => {
    const res = await postWebhook('ping', { zen: 'Keep it simple', repository });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('mirrors an opened issue that carries a known reporter marker', async () => {
    await ensureReporter();
    const res = await postWebhook('issues', {
      action: 'opened',
      issue: issuePayload(502),
      repository,
    });
    expect(res.status).toBe(204);
    expect(await getIssue(db, 502)).toEqual({
      number: 502,
      reporterId: REPORTER,
      state: 'open',
      title: 'Mirrored title',
      createdAt: SEC_1,
      updatedAt: SEC_1,
      createdVia: 'github',
    });
  });

  it('ignores an opened issue without a marker', async () => {
    const res = await postWebhook('issues', {
      action: 'opened',
      issue: issuePayload(503, { body: 'no marker' }),
      repository,
    });
    expect(res.status).toBe(204);
    expect(await issueCount(503)).toBe(0);
  });

  it('ignores an issue whose marker names an unknown reporter', async () => {
    const res = await postWebhook('issues', {
      action: 'opened',
      issue: issuePayload(504, { body: '<!-- moss-feedback reporter=nobody123456 -->' }),
      repository,
    });
    expect(res.status).toBe(204);
    expect(await issueCount(504)).toBe(0);
  });

  it('records a close on a tracked issue', async () => {
    await trackIssue(505);
    const res = await postWebhook('issues', {
      action: 'closed',
      issue: issuePayload(505, {
        state: 'closed',
        state_reason: 'completed',
        updated_at: ISO_2,
        body: 'marker removed',
      }),
      repository,
    });
    expect(res.status).toBe(204);
    expect(await getIssue(db, 505)).toMatchObject({
      reporterId: REPORTER,
      state: 'closed',
      stateReason: 'completed',
      createdVia: 'worker',
      createdAt: 100,
      updatedAt: SEC_2,
    });
  });

  it('removes a tracked issue that GitHub deleted', async () => {
    await trackIssue(506);
    const res = await postWebhook('issues', {
      action: 'deleted',
      issue: issuePayload(506),
      repository,
    });
    expect(res.status).toBe(204);
    expect(await issueCount(506)).toBe(0);
  });

  it('stores a new comment and bumps the issue update time', async () => {
    await trackIssue(507);
    const res = await postWebhook('issue_comment', {
      action: 'created',
      issue: issuePayload(507),
      comment: commentPayload(7001),
      repository,
    });
    expect(res.status).toBe(204);
    expect(await commentRow(7001)).toMatchObject({
      body: 'A reply',
      posted_for_reporter: 0,
      deleted_at: null,
      updated_at: SEC_2,
    });
    expect((await getIssue(db, 507))?.updatedAt).toBe(SEC_2);
  });

  it('mirrors an untracked marked issue before storing its comment', async () => {
    await ensureReporter();
    const res = await postWebhook('issue_comment', {
      action: 'created',
      issue: issuePayload(508),
      comment: commentPayload(7002),
      repository,
    });
    expect(res.status).toBe(204);
    expect((await getIssue(db, 508))?.createdVia).toBe('github');
    expect(await commentRow(7002)).not.toBeNull();
  });

  it('ignores a comment on an untracked issue without a marker', async () => {
    const res = await postWebhook('issue_comment', {
      action: 'created',
      issue: issuePayload(509, { body: null }),
      comment: commentPayload(7003),
      repository,
    });
    expect(res.status).toBe(204);
    expect(await issueCount(509)).toBe(0);
    expect(await commentRow(7003)).toBeNull();
  });

  it('marks a deleted comment', async () => {
    await trackIssue(510);
    await postWebhook('issue_comment', {
      action: 'created',
      issue: issuePayload(510),
      comment: commentPayload(7004),
      repository,
    });
    const res = await postWebhook('issue_comment', {
      action: 'deleted',
      issue: issuePayload(510),
      comment: commentPayload(7004),
      repository,
    });
    expect(res.status).toBe(204);
    expect((await commentRow(7004))?.deleted_at).not.toBeNull();
  });

  it('does not resurrect a deleted comment on a late edit', async () => {
    await trackIssue(511);
    await upsertComment(db, {
      id: 7005,
      issueNumber: 511,
      authorLogin: 'alice',
      authorAssociation: 'MEMBER',
      postedForReporter: false,
      body: 'gone',
      createdAt: 100,
      updatedAt: 150,
      deletedAt: 150,
    });
    const res = await postWebhook('issue_comment', {
      action: 'edited',
      issue: issuePayload(511),
      comment: commentPayload(7005, { body: 'edited after delete' }),
      repository,
    });
    expect(res.status).toBe(204);
    expect(await commentRow(7005)).toMatchObject({ body: 'gone', deleted_at: 150 });
  });

  it('keeps posted_for_reporter on the echo of a comment the worker posted', async () => {
    await trackIssue(512);
    await upsertComment(db, {
      id: 7006,
      issueNumber: 512,
      authorLogin: 'moss-feedback[bot]',
      authorAssociation: 'NONE',
      postedForReporter: true,
      body: 'from the reporter',
      createdAt: 100,
      updatedAt: 100,
    });
    const res = await postWebhook('issue_comment', {
      action: 'edited',
      issue: issuePayload(512),
      comment: commentPayload(7006, { body: 'from the reporter, edited' }),
      repository,
    });
    expect(res.status).toBe(204);
    expect(await commentRow(7006)).toMatchObject({
      body: 'from the reporter, edited',
      posted_for_reporter: 1,
    });
  });
});
