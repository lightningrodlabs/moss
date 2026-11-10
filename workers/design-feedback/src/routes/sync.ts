import {
  FEEDBACK_LIMITS,
  validateSyncRequest,
  type FeedbackCommentWire,
  type SyncIssue,
  type SyncRequest,
} from '../../../../shared/utils/src/feedback/index.ts';
import { authenticate } from '../auth';
import { commentsSince, getIssue, type CommentRow, type StoredIssue } from '../db';
import type { Env } from '../env';
import { backfillScope, consume, globalBackfillScope, ipScope } from '../rateLimit';
import { jsonError, jsonOk, type Route } from '../router';
import { backfillIssue, isKnownMiss } from '../syncBackfill';

export type SyncDeps = { fetchImpl?: typeof fetch; nowMs?: () => number };

function parseJson(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false };
  }
}

/** A deleted comment travels without its text; the client only shows that it was deleted. */
function toWire(c: CommentRow): FeedbackCommentWire {
  const deleted = c.deletedAt !== undefined;
  return {
    id: c.id,
    authorLogin: c.authorLogin,
    authorAssociation: c.authorAssociation,
    postedForReporter: c.postedForReporter,
    body: deleted ? '' : c.body,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    deleted,
  };
}

async function toSyncIssue(db: D1Database, issue: StoredIssue, since: number): Promise<SyncIssue> {
  const out: SyncIssue = {
    number: issue.number,
    state: issue.state,
    title: issue.title,
    updatedAt: issue.updatedAt,
    comments: (await commentsSince(db, issue.number, since)).map(toWire),
  };
  if (issue.stateReason !== undefined) out.stateReason = issue.stateReason;
  return out;
}

/** Keeps the first occurrence of each issue number, in request order. */
function uniqueByNumber(issues: SyncRequest['issues']): SyncRequest['issues'] {
  const seen = new Set<number>();
  return issues.filter((i) => {
    if (seen.has(i.number)) return false;
    seen.add(i.number);
    return true;
  });
}

/**
 * The signed `POST /v1/sync` route: returns state and new comments for the reporter's own
 * issues. An issue D1 does not track yet is adopted from GitHub when its body carries this
 * reporter's marker; issues belonging to anyone else are silently omitted.
 */
export function syncRoute(deps: SyncDeps = {}): Route {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return {
    method: 'POST',
    path: /^\/v1\/sync$/,
    handler: async (req, env: Env) => {
      const { allowed, retryAfterSeconds } = await consume(env.FEEDBACK_KV, ipScope(req), nowMs);
      if (!allowed) {
        const res = jsonError(429, 'rate_limited', 'Too many requests, try again later');
        res.headers.set('Retry-After', String(retryAfterSeconds));
        return res;
      }

      const authed = await authenticate(req, env, nowMs);
      if (authed instanceof Response) return authed;

      const parsed = parseJson(authed.body);
      if (!parsed.ok) return jsonError(400, 'bad_request', 'Request body must be valid JSON');
      const input = validateSyncRequest(parsed.value);
      if ('error' in input) return jsonError(400, input.error, input.message);

      const db = env.FEEDBACK_DB;
      const nowSeconds = Math.floor(nowMs() / 1000);
      const issues: SyncIssue[] = [];
      let backfillAttempts = 0;
      for (const { number, since } of uniqueByNumber(input.issues)) {
        const stored = await getIssue(db, number);
        if (stored) {
          if (stored.reporterId === authed.reporterId) {
            issues.push(await toSyncIssue(db, stored, since));
          }
          continue;
        }
        // Each attempt costs GitHub reads whether or not it adopts, so attempts are what is bounded.
        if (backfillAttempts >= FEEDBACK_LIMITS.backfillsPerSyncRequest) continue;
        if (await isKnownMiss(env.FEEDBACK_KV, number, authed.reporterId)) continue;
        backfillAttempts++;
        const budget = await consume(env.FEEDBACK_KV, backfillScope(authed.reporterId), nowMs);
        if (!budget.allowed) continue;
        const global = await consume(env.FEEDBACK_KV, globalBackfillScope(), nowMs);
        if (!global.allowed) continue;
        const outcome = await backfillIssue(env, number, authed, nowSeconds, deps.fetchImpl);
        if (outcome !== 'adopted') continue;
        const backfilled = await getIssue(db, number);
        // The client has never seen a backfilled thread, so it gets the whole thing.
        if (backfilled?.reporterId === authed.reporterId) {
          issues.push(await toSyncIssue(db, backfilled, 0));
        }
      }
      return jsonOk({ issues });
    },
  };
}
