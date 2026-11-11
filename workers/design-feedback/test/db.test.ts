import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  commentsSince,
  deleteIssue,
  getIssue,
  recordIssue,
  softDeleteComment,
  touchIssue,
  upsertComment,
  upsertIssue,
  type CommentRow,
  type StoredIssue,
} from '../src/db';

const db = env.FEEDBACK_DB;
const reporter = { reporterId: 'rep1', pubKey: new Uint8Array([1, 2, 3]) };

function issue(number: number, over: Partial<StoredIssue> = {}): StoredIssue {
  return {
    number,
    reporterId: 'rep1',
    state: 'open',
    title: 'T',
    createdAt: 100,
    updatedAt: 100,
    createdVia: 'worker',
    ...over,
  };
}

function comment(id: number, issueNumber: number, over: Partial<CommentRow> = {}): CommentRow {
  return {
    id,
    issueNumber,
    authorLogin: 'alice',
    authorAssociation: 'MEMBER',
    postedForReporter: false,
    body: 'hi',
    createdAt: 200,
    updatedAt: 200,
    ...over,
  };
}

async function seedIssue(number: number): Promise<void> {
  await recordIssue(db, reporter, {
    number,
    reporterId: 'rep1',
    title: 'T',
    createdAt: 100,
    createdVia: 'worker',
  });
}

describe('issues', () => {
  it('round-trips an upserted issue', async () => {
    await seedIssue(1);
    await upsertIssue(db, issue(2, { state: 'closed', stateReason: 'completed' }));
    expect(await getIssue(db, 2)).toEqual(issue(2, { state: 'closed', stateReason: 'completed' }));
    expect(await getIssue(db, 999)).toBeUndefined();
  });

  it('keeps reporter and origin on conflict', async () => {
    await seedIssue(3);
    await upsertIssue(
      db,
      issue(3, {
        reporterId: 'other',
        createdVia: 'github',
        state: 'closed',
        title: 'New',
        updatedAt: 300,
      }),
    );
    const got = await getIssue(db, 3);
    expect(got).toMatchObject({
      reporterId: 'rep1',
      createdVia: 'worker',
      state: 'closed',
      title: 'New',
      updatedAt: 300,
    });
  });

  it('recordIssue twice for the same number does not throw', async () => {
    await seedIssue(4);
    await seedIssue(4);
    expect((await getIssue(db, 4))?.number).toBe(4);
  });

  it('touchIssue only moves updated_at forward', async () => {
    await seedIssue(5);
    await touchIssue(db, 5, 500);
    expect((await getIssue(db, 5))?.updatedAt).toBe(500);
    await touchIssue(db, 5, 400);
    expect((await getIssue(db, 5))?.updatedAt).toBe(500);
  });

  it('deleteIssue removes its comments', async () => {
    await seedIssue(6);
    await upsertComment(db, comment(60, 6));
    await deleteIssue(db, 6);
    expect(await getIssue(db, 6)).toBeUndefined();
    expect(await commentsSince(db, 6, 0)).toEqual([]);
  });
});

describe('comments', () => {
  it('returns comments updated at or after since, ordered by creation', async () => {
    await seedIssue(10);
    await upsertComment(
      db,
      comment(102, 10, { createdAt: 300, updatedAt: 300, postedForReporter: true }),
    );
    await upsertComment(db, comment(101, 10));
    expect(await commentsSince(db, 10, 0)).toEqual([
      comment(101, 10),
      comment(102, 10, { createdAt: 300, updatedAt: 300, postedForReporter: true }),
    ]);
    expect((await commentsSince(db, 10, 200)).map((c) => c.id)).toEqual([101, 102]);
    expect((await commentsSince(db, 10, 201)).map((c) => c.id)).toEqual([102]);
    expect((await commentsSince(db, 10, 300)).map((c) => c.id)).toEqual([102]);
    expect(await commentsSince(db, 10, 301)).toEqual([]);
  });

  it('conflict updates edit fields but not posted_for_reporter', async () => {
    await seedIssue(11);
    await upsertComment(db, comment(110, 11, { postedForReporter: true }));
    await upsertComment(
      db,
      comment(110, 11, { body: 'edited', updatedAt: 250, authorAssociation: 'OWNER' }),
    );
    const [got] = await commentsSince(db, 11, 0);
    expect(got).toMatchObject({
      body: 'edited',
      updatedAt: 250,
      authorAssociation: 'OWNER',
      postedForReporter: true,
    });
  });

  it('a later upsert flagged for the reporter raises posted_for_reporter on an unflagged row', async () => {
    await seedIssue(13);
    await upsertComment(db, comment(130, 13));
    await upsertComment(db, comment(130, 13, { postedForReporter: true }));
    const [got] = await commentsSince(db, 13, 0);
    expect(got.postedForReporter).toBe(true);
  });

  it('softDeleteComment sets deletedAt and bumps updatedAt', async () => {
    await seedIssue(12);
    await upsertComment(db, comment(120, 12));
    await softDeleteComment(db, 120, 400);
    const got = await commentsSince(db, 12, 200);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ deletedAt: 400, updatedAt: 400 });
  });
});
