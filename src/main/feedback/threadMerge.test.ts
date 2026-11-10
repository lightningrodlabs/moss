import { describe, expect, it } from 'vitest';
import type { FeedbackCommentWire, SyncIssue } from '@theweave/utils';
import type { FeedbackRecord } from './recordStore';
import { mergeSyncIssue, recordUnread, syncCursor, totalUnread } from './threadMerge';

const comment = (id: number, over: Partial<FeedbackCommentWire> = {}): FeedbackCommentWire => ({
  id,
  authorLogin: 'dev',
  authorAssociation: 'MEMBER',
  postedForReporter: false,
  body: `c${id}`,
  createdAt: id * 10,
  updatedAt: id * 10,
  deleted: false,
  ...over,
});

const record = (over: Partial<FeedbackRecord> = {}): FeedbackRecord => ({
  id: '1-aaaaaa',
  text: 't',
  screenshot: '',
  mossVersion: '1',
  os: 'linux',
  timestamp: 1,
  state: 'open',
  issueNumber: 7,
  ...over,
});

const issue = (over: Partial<SyncIssue> = {}): SyncIssue => ({
  number: 7,
  state: 'open',
  title: 'Title',
  updatedAt: 100,
  comments: [],
  ...over,
});

describe('mergeSyncIssue', () => {
  it('replaces an edited comment by id, keeps others and sorts by createdAt', () => {
    const rec = record({ comments: [comment(1), comment(3)] });
    const merged = mergeSyncIssue(
      rec,
      issue({ comments: [comment(3, { body: 'edited' }), comment(2)] }),
    );
    expect(merged.comments?.map((c) => [c.id, c.body])).toEqual([
      [1, 'c1'],
      [2, 'c2'],
      [3, 'edited'],
    ]);
  });

  it('breaks createdAt ties by id', () => {
    const merged = mergeSyncIssue(
      record(),
      issue({ comments: [comment(5, { createdAt: 1 }), comment(4, { createdAt: 1 })] }),
    );
    expect(merged.comments?.map((c) => c.id)).toEqual([4, 5]);
  });

  it('keeps a deleted comment in the list', () => {
    const merged = mergeSyncIssue(
      record({ comments: [comment(1)] }),
      issue({ comments: [comment(1, { deleted: true, body: '' })] }),
    );
    expect(merged.comments).toHaveLength(1);
    expect(merged.comments?.[0].deleted).toBe(true);
  });

  it('takes state, stateReason, title and issueUpdatedAt from the issue and drops a missing reason', () => {
    const closed = mergeSyncIssue(
      record(),
      issue({ state: 'closed', stateReason: 'completed', title: 'New', updatedAt: 200 }),
    );
    expect(closed).toMatchObject({
      state: 'closed',
      stateReason: 'completed',
      title: 'New',
      issueUpdatedAt: 200,
    });
    const reopened = mergeSyncIssue(closed, issue({ state: 'open', updatedAt: 300 }));
    expect('stateReason' in reopened).toBe(false);
    expect(reopened.state).toBe('open');
  });

  it('does not mutate its input', () => {
    const rec = record({ comments: [comment(1)], stateReason: 'x' });
    const snapshot = structuredClone(rec);
    mergeSyncIssue(rec, issue({ comments: [comment(1, { body: 'z' }), comment(2)] }));
    expect(rec).toEqual(snapshot);
  });
});

describe('unread', () => {
  it('excludes deleted comments and respects lastReadAt', () => {
    const rec = record({
      lastReadAt: 10,
      comments: [comment(1), comment(2), comment(3, { deleted: true })],
    });
    expect(recordUnread(rec)).toBe(1);
  });

  it('is zero for records without comments', () => {
    expect(recordUnread(record())).toBe(0);
  });

  it('totalUnread sums across records', () => {
    const a = record({ comments: [comment(1), comment(2)] });
    const b = record({ comments: [comment(1)] });
    expect(totalUnread([a, b, record()])).toBe(3);
  });
});

describe('syncCursor', () => {
  it('is undefined for a local-only record', () => {
    expect(syncCursor(record({ issueNumber: undefined, state: 'local-only' }))).toBeUndefined();
  });
  it('uses issueUpdatedAt, defaulting to 0', () => {
    expect(syncCursor(record())).toEqual({ number: 7, since: 0 });
    expect(syncCursor(record({ issueUpdatedAt: 55 }))).toEqual({ number: 7, since: 55 });
  });
});
