import type { ResolveResponse } from '../../../../shared/utils/src/feedback/index.ts';
import { upsertCommentStatement, upsertIssueStatement } from '../db';
import {
  GitHubError,
  closeIssue,
  createComment,
  type GitHubComment,
  type GitHubIssue,
} from '../github';
import { commentScope } from '../rateLimit';
import { jsonError, jsonOk, type Route } from '../router';
import { isoToSeconds } from '../webhook';
import { ownedIssue, parseJson, rateLimited, type IssueWriteDeps } from './ownedIssue';

const PATH = /^\/v1\/issues\/(\d{1,9})\/resolve$/;
const RESOLVE_COMMENT = 'Closed as resolved by the reporter from Moss';
const GITHUB_FAILURE = 'Could not resolve the issue on GitHub';

/**
 * The signed `POST /v1/issues/:number/resolve` route: the reporter closes their own issue as
 * completed. A note goes on the thread first so maintainers see who closed it and why.
 */
export function resolveRoute(deps: IssueWriteDeps = {}): Route {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return {
    method: 'POST',
    path: PATH,
    handler: async (req, env) => {
      const owned = await ownedIssue(req, env, PATH, nowMs);
      if (owned instanceof Response) return owned;
      const { authed, issue } = owned;

      // The body carries nothing; it only has to be absent or JSON.
      if (authed.body.length > 0 && !parseJson(authed.body).ok) {
        return jsonError(400, 'bad_request', 'Request body must be valid JSON');
      }
      if (issue.state === 'closed') return jsonError(409, 'conflict', 'Issue is already closed');

      const limited = await rateLimited(env, commentScope(authed.reporterId), nowMs);
      if (limited) return limited;

      let comment: GitHubComment;
      let closed: GitHubIssue;
      try {
        comment = await createComment(env, issue.number, RESOLVE_COMMENT, deps.fetchImpl);
        // A close that fails after the note posted is left for the webhook to reconcile.
        closed = await closeIssue(env, issue.number, deps.fetchImpl);
      } catch (err) {
        if (!(err instanceof GitHubError)) throw err;
        return jsonError(502, 'github_error', GITHUB_FAILURE);
      }

      const nowSeconds = Math.floor(nowMs() / 1000);
      const commentCreatedAt = isoToSeconds(comment.created_at) ?? nowSeconds;
      const closedAt = isoToSeconds(closed.updated_at) ?? nowSeconds;
      const db = env.FEEDBACK_DB;
      await db.batch([
        upsertCommentStatement(db, {
          id: comment.id,
          issueNumber: issue.number,
          authorLogin: comment.user.login,
          authorAssociation: comment.author_association,
          postedForReporter: true,
          body: comment.body,
          createdAt: commentCreatedAt,
          updatedAt: isoToSeconds(comment.updated_at) ?? commentCreatedAt,
        }),
        upsertIssueStatement(db, {
          ...issue,
          state: 'closed',
          stateReason: 'completed',
          updatedAt: closedAt,
        }),
      ]);

      const response: ResolveResponse = { state: 'closed', closedAt };
      return jsonOk(response);
    },
  };
}
