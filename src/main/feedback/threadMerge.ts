import type { SyncIssue } from '@theweave/utils';
import { FEEDBACK_LIMITS, unreadTeamComments } from '@theweave/utils';
import type { FeedbackRecord, FeedbackRecordSummary } from './recordStore';

/** Folds a synced issue into a record without mutating it; incoming comments win by id. */
export function mergeSyncIssue(record: FeedbackRecord, issue: SyncIssue): FeedbackRecord {
  const byId = new Map((record.comments ?? []).map((c) => [c.id, c]));
  for (const c of issue.comments) byId.set(c.id, c);
  const comments = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  const { stateReason: _previousReason, ...rest } = record;
  const merged: FeedbackRecord = {
    ...rest,
    state: issue.state,
    title: issue.title,
    issueUpdatedAt: issue.updatedAt,
    comments,
  };
  if (issue.stateReason !== undefined) merged.stateReason = issue.stateReason;
  return merged;
}

/** Number of team comments the reporter has not yet seen. */
export function recordUnread(record: FeedbackRecordSummary): number {
  return unreadTeamComments(record.comments ?? [], record.lastReadAt);
}

export function totalUnread(records: FeedbackRecordSummary[]): number {
  return records.reduce((sum, r) => sum + recordUnread(r), 0);
}

/**
 * What to ask the worker for. Local-only records have no issue to sync, and
 * records the pre-phase-1 worker filed (no createdVia) carry no ownership
 * marker, so the worker can never adopt them.
 */
export function syncCursor(
  record: FeedbackRecordSummary,
): { number: number; since: number } | undefined {
  if (record.issueNumber === undefined || record.createdVia === undefined) return undefined;
  const since = Math.max(0, (record.issueUpdatedAt ?? 0) - FEEDBACK_LIMITS.syncOverlapSeconds);
  return { number: record.issueNumber, since };
}
