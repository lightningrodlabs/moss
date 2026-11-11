import { describe, it, expect } from 'vitest';
import type { FeedbackErrorResponse } from './protocol.js';
import {
  SYNC_MAX_ISSUES,
  buildReplyBody,
  commentRole,
  unreadTeamComments,
  validateReplyRequest,
  validateSyncRequest,
  type FeedbackCommentWire,
} from './threads.js';

const base: FeedbackCommentWire = {
  id: 1,
  authorLogin: 'someone',
  authorAssociation: 'OWNER',
  postedForReporter: false,
  body: 'hi',
  createdAt: 10,
  updatedAt: 10,
  deleted: false,
};
const team = base;
const other: FeedbackCommentWire = { ...base, authorAssociation: 'NONE' };

describe('commentRole', () => {
  it('classifies OWNER, MEMBER and COLLABORATOR as team, posted_for_reporter as reporter, else other', () => {
    for (const a of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      expect(commentRole({ authorAssociation: a, postedForReporter: false })).toBe('team');
    }
    expect(commentRole({ authorAssociation: 'OWNER', postedForReporter: true })).toBe('reporter');
    expect(commentRole({ authorAssociation: 'NONE', postedForReporter: true })).toBe('reporter');
    expect(commentRole({ authorAssociation: 'CONTRIBUTOR', postedForReporter: false })).toBe('other');
  });
});

describe('unreadTeamComments', () => {
  it('counts team comments created after lastReadAt and ignores deleted and edited-only ones', () => {
    const read = [{ ...team, createdAt: 10, updatedAt: 50 }];
    expect(unreadTeamComments(read, 20)).toBe(0);
    expect(
      unreadTeamComments(
        [{ ...team, createdAt: 30 }, { ...team, createdAt: 30, deleted: true }, { ...other, createdAt: 30 }],
        20,
      ),
    ).toBe(1);
    expect(unreadTeamComments([{ ...team, createdAt: 30 }], undefined)).toBe(1);
  });
});

const syncError = (req: unknown): string => (validateSyncRequest(req) as FeedbackErrorResponse).error;

describe('validateSyncRequest', () => {
  it('accepts well formed requests', () => {
    const req = { issues: [{ number: 1, since: 0 }, { number: 7, since: 123 }] };
    expect(validateSyncRequest(req)).toEqual(req);
    expect(validateSyncRequest({ issues: [] })).toEqual({ issues: [] });
  });
  it('rejects more than 100 issues, non-integer numbers and negative since', () => {
    expect(SYNC_MAX_ISSUES).toBe(100);
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ number: i + 1, since: 0 }));
    expect(validateSyncRequest({ issues: mk(100) })).toEqual({ issues: mk(100) });
    expect(syncError({ issues: mk(101) })).toBe('bad_request');
    expect(syncError({ issues: [{ number: 1.5, since: 0 }] })).toBe('bad_request');
    expect(syncError({ issues: [{ number: 0, since: 0 }] })).toBe('bad_request');
    expect(syncError({ issues: [{ number: 1, since: -1 }] })).toBe('bad_request');
    expect(syncError({ issues: [{ number: 1, since: 0.5 }] })).toBe('bad_request');
    expect(syncError({ issues: [null] })).toBe('bad_request');
    expect(syncError({ issues: 'x' })).toBe('bad_request');
    expect(syncError(null)).toBe('bad_request');
  });
});

describe('validateReplyRequest', () => {
  it('trims, rejects whitespace and text over 10000 chars', () => {
    expect(validateReplyRequest({ text: '  hello \n' })).toEqual({ text: 'hello' });
    expect((validateReplyRequest({ text: ' \n\t' }) as FeedbackErrorResponse).error).toBe('bad_request');
    expect((validateReplyRequest({ text: 5 }) as FeedbackErrorResponse).error).toBe('bad_request');
    expect((validateReplyRequest(null) as FeedbackErrorResponse).error).toBe('bad_request');
    expect((validateReplyRequest({ text: 'a'.repeat(10_001) }) as FeedbackErrorResponse).error).toBe(
      'text_too_long',
    );
    expect(validateReplyRequest({ text: 'a'.repeat(10_000) })).toEqual({ text: 'a'.repeat(10_000) });
  });
});

describe('buildReplyBody', () => {
  it('quotes every line under the Reporter header', () => {
    expect(buildReplyBody('a\nb')).toBe('**Reporter** replied:\n\n> a\n> b');
  });

  it('quotes a line that follows a lone carriage return', () => {
    expect(buildReplyBody('a\rb')).toBe('**Reporter** replied:\n\n> a\n> b');
    expect(buildReplyBody('a\r\nb')).toBe('**Reporter** replied:\n\n> a\n> b');
  });
});
