import { parseReporterMarker } from '../../../shared/utils/src/feedback/index.ts';
import {
  upsertCommentStatement,
  upsertIssueStatement,
  upsertReporterStatement,
  type StoredIssue,
} from './db';
import type { Env } from './env';
import { getIssue as readGitHubIssue, listIssueComments, type GitHubIssue } from './github';
import { isoToSeconds } from './webhook';

export type BackfillReporter = { reporterId: string; pubKey: Uint8Array };

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

async function adopt(
  env: Env,
  number: number,
  reporter: BackfillReporter,
  nowSeconds: number,
  fetchImpl: typeof fetch | undefined,
): Promise<boolean> {
  const issue = await readGitHubIssue(env, number, fetchImpl);
  if (parseReporterMarker(issue.body ?? '') !== reporter.reporterId) return false;
  const comments = await listIssueComments(env, number, fetchImpl);

  const db = env.FEEDBACK_DB;
  // One batch, so a thread is either stored whole with its reporter or not at all.
  await db.batch([
    upsertReporterStatement(db, reporter.reporterId, reporter.pubKey, nowSeconds),
    upsertIssueStatement(db, toStoredIssue(issue, reporter.reporterId)),
    ...comments.map((c) => {
      const updatedAt = isoToSeconds(c.updated_at) ?? nowSeconds;
      return upsertCommentStatement(db, {
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
    }),
  ]);
  return true;
}

/**
 * Adopts an issue D1 does not track yet when its GitHub body names this reporter, storing
 * it with its comments. Returns whether it was adopted; the marker is the only proof of
 * ownership, so any other issue is left alone and never stored. Any failure (GitHub,
 * network, subrequest limit, D1) only skips this number, which the client retries next sync.
 */
export async function backfillIssue(
  env: Env,
  number: number,
  reporter: BackfillReporter,
  nowSeconds: number,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  try {
    return await adopt(env, number, reporter, nowSeconds, fetchImpl);
  } catch {
    return false;
  }
}
