import { parseReporterMarker } from '../../../shared/utils/src/feedback/index.ts';
import { ensureReporter, upsertComment, upsertIssue, type StoredIssue } from './db';
import type { Env } from './env';
import {
  GitHubError,
  getIssue as readGitHubIssue,
  listIssueComments,
  type GitHubIssue,
} from './github';
import { isoToSeconds } from './webhook';

export type BackfillReporter = { reporterId: string; pubKey: Uint8Array };

/** Runs a GitHub read, mapping a GitHub or network failure to undefined. */
async function readOrSkip<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (err) {
    // fetch reports network failures as TypeError.
    if (err instanceof GitHubError || err instanceof TypeError) return undefined;
    throw err;
  }
}

function toStoredIssue(issue: GitHubIssue, reporterId: string): StoredIssue {
  const createdAt = isoToSeconds(issue.created_at) ?? 0;
  const row: StoredIssue = {
    number: issue.number,
    reporterId,
    state: issue.state,
    title: issue.title,
    createdAt,
    updatedAt: isoToSeconds(issue.updated_at) ?? createdAt,
    createdVia: 'github',
  };
  if (issue.state_reason !== null) row.stateReason = issue.state_reason;
  return row;
}

/**
 * Adopts an issue D1 does not track yet when its GitHub body names this reporter, storing
 * it with its comments. Returns whether it was adopted; the marker is the only proof of
 * ownership, so any other issue is left alone and never stored.
 */
export async function backfillIssue(
  env: Env,
  number: number,
  reporter: BackfillReporter,
  nowSeconds: number,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  const issue = await readOrSkip(() => readGitHubIssue(env, number, fetchImpl));
  if (!issue || parseReporterMarker(issue.body ?? '') !== reporter.reporterId) return false;
  const comments = await readOrSkip(() => listIssueComments(env, number, fetchImpl));
  if (!comments) return false;

  const db = env.FEEDBACK_DB;
  await ensureReporter(db, reporter.reporterId, reporter.pubKey, nowSeconds);
  await upsertIssue(db, toStoredIssue(issue, reporter.reporterId));
  for (const c of comments) {
    const updatedAt = isoToSeconds(c.updated_at) ?? nowSeconds;
    await upsertComment(db, {
      id: c.id,
      issueNumber: number,
      authorLogin: c.user.login,
      authorAssociation: c.author_association,
      // GitHub does not record who a comment was relayed for, so a backfilled one is never claimed.
      postedForReporter: false,
      body: c.body,
      createdAt: isoToSeconds(c.created_at) ?? updatedAt,
      updatedAt,
    });
  }
  return true;
}
