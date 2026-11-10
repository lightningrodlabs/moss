import { FEEDBACK_LIMITS, type FeedbackErrorResponse } from './protocol.js';

export type CommentRole = 'team' | 'reporter' | 'other';

/** Timestamps are in seconds. */
export type FeedbackCommentWire = {
  id: number;
  authorLogin: string;
  authorAssociation: string;
  postedForReporter: boolean;
  body: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
};

export type IssueState = 'open' | 'closed';

/** `since` is the last seen updatedAt, 0 to fetch everything. */
export type SyncRequest = { issues: Array<{ number: number; since: number }> };

export type SyncIssue = {
  number: number;
  state: IssueState;
  stateReason?: string;
  title: string;
  updatedAt: number;
  comments: FeedbackCommentWire[];
};

export type SyncResponse = { issues: SyncIssue[] };
export type ReplyRequest = { text: string };
export type ReplyResponse = { commentId: number; createdAt: number };
export type ResolveResponse = { state: 'closed'; closedAt: number };

export const SYNC_MAX_ISSUES = 100;

const TEAM_ASSOCIATIONS: ReadonlySet<string> = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

function fail(error: FeedbackErrorResponse['error'], message: string): FeedbackErrorResponse {
  return { error, message };
}

/** Checks an untrusted sync body so the worker only queries a bounded set of valid issue numbers. */
export function validateSyncRequest(req: unknown): SyncRequest | FeedbackErrorResponse {
  if (typeof req !== 'object' || req === null || Array.isArray(req)) {
    return fail('bad_request', 'Request body must be a JSON object');
  }
  const issues = (req as Record<string, unknown>).issues;
  if (!Array.isArray(issues)) return fail('bad_request', 'issues must be an array');
  if (issues.length > SYNC_MAX_ISSUES) {
    return fail('bad_request', `issues must contain at most ${SYNC_MAX_ISSUES} entries`);
  }
  const out: SyncRequest['issues'] = [];
  for (const item of issues) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return fail('bad_request', 'each issue must be an object');
    }
    const { number, since } = item as Record<string, unknown>;
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
      return fail('bad_request', 'issue number must be a positive integer');
    }
    if (typeof since !== 'number' || !Number.isInteger(since) || since < 0) {
      return fail('bad_request', 'since must be a non-negative integer');
    }
    out.push({ number, since });
  }
  return { issues: out };
}

/** Checks an untrusted reply body and returns the trimmed text. */
export function validateReplyRequest(req: unknown): ReplyRequest | FeedbackErrorResponse {
  if (typeof req !== 'object' || req === null || Array.isArray(req)) {
    return fail('bad_request', 'Request body must be a JSON object');
  }
  const text = (req as Record<string, unknown>).text;
  if (typeof text !== 'string') return fail('bad_request', 'text must be a string');
  const trimmed = text.trim();
  if (trimmed.length === 0) return fail('bad_request', 'text must not be empty');
  if (trimmed.length > FEEDBACK_LIMITS.maxTextChars) {
    return fail('text_too_long', `text exceeds ${FEEDBACK_LIMITS.maxTextChars} characters`);
  }
  return { text: trimmed };
}

/** A reporter reply is posted by the worker's bot, so the flag outranks the GitHub association. */
export function commentRole(c: { authorAssociation: string; postedForReporter: boolean }): CommentRole {
  if (c.postedForReporter) return 'reporter';
  if (TEAM_ASSOCIATIONS.has(c.authorAssociation)) return 'team';
  return 'other';
}

/** Counts by creation time, so a team comment edited after being read stays read. */
export function unreadTeamComments(comments: FeedbackCommentWire[], lastReadAt: number | undefined): number {
  const readAt = lastReadAt ?? 0;
  return comments.filter((c) => commentRole(c) === 'team' && !c.deleted && c.createdAt > readAt).length;
}

/** Quotes every line so the reporter's text cannot forge structure outside the header. */
export function buildReplyBody(text: string): string {
  const quoted = text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
  return `**Reporter** replied:\n\n${quoted}`;
}
