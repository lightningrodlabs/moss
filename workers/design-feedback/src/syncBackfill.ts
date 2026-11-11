import { FEEDBACK_LIMITS, parseReporterMarker } from '../../../shared/utils/src/feedback/index.ts';
import {
  upsertCommentStatement,
  upsertIssueStatement,
  upsertReporterStatement,
  type StoredIssue,
} from './db';
import type { Env } from './env';
import {
  GitHubError,
  getIssue as readGitHubIssue,
  listIssueComments,
  type GitHubIssue,
} from './github';
import { isoToSeconds } from './webhook';

export type BackfillReporter = { reporterId: string; pubKey: Uint8Array };

/**
 * `adopted`: stored for this reporter. `absent`: GitHub has no such issue, so nobody can
 * adopt it. `not-theirs`: the issue's marker names someone else. `failed`: anything else,
 * worth retrying next sync.
 */
export type BackfillOutcome = 'adopted' | 'absent' | 'not-theirs' | 'failed';

/** Shared by every reporter: an issue that does not exist cannot be adopted by anyone. */
function absentKey(number: number): string {
  return `backfill-miss:${number}`;
}

/** Scoped to the probing reporter, so probing a number never blocks its real owner. */
function notTheirsKey(number: number, reporterId: string): string {
  return `backfill-miss:${number}:${reporterId}`;
}

/** Whether a recent backfill of this number found no issue this reporter can adopt. */
export async function isKnownMiss(
  kv: KVNamespace,
  number: number,
  reporterId: string,
): Promise<boolean> {
  const [absent, notTheirs] = await Promise.all([
    kv.get(absentKey(number)),
    kv.get(notTheirsKey(number, reporterId)),
  ]);
  return absent !== null || notTheirs !== null;
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

async function adopt(
  env: Env,
  number: number,
  reporter: BackfillReporter,
  nowSeconds: number,
  fetchImpl: typeof fetch | undefined,
): Promise<BackfillOutcome> {
  const issue = await readGitHubIssue(env, number, fetchImpl);
  if (parseReporterMarker(issue.body ?? '') !== reporter.reporterId) return 'not-theirs';
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
  return 'adopted';
}

/**
 * Adopts an issue D1 does not track yet when its GitHub body names this reporter, storing
 * it with its comments. The marker is the only proof of ownership, so any other issue is
 * left alone and never stored; a miss is remembered in KV so repeat syncs skip GitHub. Any
 * other failure (GitHub, network, subrequest limit, D1) only skips this number, which the
 * client retries next sync.
 */
export async function backfillIssue(
  env: Env,
  number: number,
  reporter: BackfillReporter,
  nowSeconds: number,
  fetchImpl?: typeof fetch,
): Promise<BackfillOutcome> {
  let outcome: BackfillOutcome;
  try {
    outcome = await adopt(env, number, reporter, nowSeconds, fetchImpl);
  } catch (e) {
    outcome = e instanceof GitHubError && e.status === 404 ? 'absent' : 'failed';
  }
  const key =
    outcome === 'absent'
      ? absentKey(number)
      : outcome === 'not-theirs'
        ? notTheirsKey(number, reporter.reporterId)
        : undefined;
  if (key !== undefined) {
    await env.FEEDBACK_KV.put(key, '1', {
      expirationTtl: FEEDBACK_LIMITS.backfillMissTtlSeconds,
    }).catch(() => undefined);
  }
  return outcome;
}
