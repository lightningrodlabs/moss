import {
  buildReplyBody,
  validateReplyRequest,
  type ReplyResponse,
} from '../../../../shared/utils/src/feedback/index.ts';
import { touchIssue, upsertComment } from '../db';
import { GitHubError, createComment, type GitHubComment } from '../github';
import { commentScope } from '../rateLimit';
import { jsonError, jsonOk, type Route } from '../router';
import { isoToSeconds } from '../webhook';
import { ownedIssue, parseJson, rateLimited, type IssueWriteDeps } from './ownedIssue';

const PATH = /^\/v1\/issues\/(\d{1,9})\/comments$/;

/** The signed `POST /v1/issues/:number/comments` route: posts a reporter's reply on their own issue as the app. */
export function replyRoute(deps: IssueWriteDeps = {}): Route {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return {
    method: 'POST',
    path: PATH,
    handler: async (req, env) => {
      const owned = await ownedIssue(req, env, PATH, nowMs);
      if (owned instanceof Response) return owned;
      const { authed, issue } = owned;

      const parsed = parseJson(authed.body);
      if (!parsed.ok) return jsonError(400, 'bad_request', 'Request body must be valid JSON');
      const input = validateReplyRequest(parsed.value);
      if ('error' in input) return jsonError(400, input.error, input.message);

      const limited = await rateLimited(env, commentScope(authed.reporterId), nowMs);
      if (limited) return limited;

      const body = buildReplyBody(input.text);
      let comment: GitHubComment;
      try {
        comment = await createComment(env, issue.number, body, deps.fetchImpl);
      } catch (err) {
        if (!(err instanceof GitHubError)) throw err;
        return jsonError(502, 'github_error', 'Could not post the comment to GitHub');
      }

      const nowSeconds = Math.floor(nowMs() / 1000);
      const createdAt = isoToSeconds(comment.created_at) ?? nowSeconds;
      await upsertComment(env.FEEDBACK_DB, {
        id: comment.id,
        issueNumber: issue.number,
        authorLogin: comment.user.login,
        authorAssociation: comment.author_association,
        postedForReporter: true,
        body: comment.body,
        createdAt,
        updatedAt: isoToSeconds(comment.updated_at) ?? createdAt,
      });
      await touchIssue(env.FEEDBACK_DB, issue.number, createdAt);

      const response: ReplyResponse = { commentId: comment.id, createdAt };
      return jsonOk(response, 201);
    },
  };
}
