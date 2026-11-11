import {
  buildIssueBody,
  buildIssueTitle,
  validateCreateIssueRequest,
} from '../../../../shared/utils/src/feedback/index.ts';
import { authenticate } from '../auth';
import { recordIssue } from '../db';
import type { Env } from '../env';
import { GitHubError, createIssue, type CreatedIssue } from '../github';
import { consume, ipScope, issueScope, type RateScope } from '../rateLimit';
import { jsonError, jsonOk, type Route } from '../router';
import { decodePngDataUrl, storeScreenshot } from '../screenshot';

export type CreateIssueDeps = { fetchImpl?: typeof fetch; nowMs?: () => number };

const ISSUE_LABEL = 'design-feedback';

/** Returns a 429 when the scope is over its limit, otherwise null. */
async function rateLimited(
  env: Env,
  scope: RateScope,
  nowMs: () => number,
): Promise<Response | null> {
  const { allowed, retryAfterSeconds } = await consume(env.FEEDBACK_KV, scope, nowMs);
  if (allowed) return null;
  const res = jsonError(429, 'rate_limited', 'Too many requests, try again later');
  res.headers.set('Retry-After', String(retryAfterSeconds));
  return res;
}

function parseJson(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false };
  }
}

/** Object key of a screenshot from the public URL `storeScreenshot` returned. */
function screenshotKey(url: string): string {
  return new URL(url).pathname.replace(/^\/+/, '');
}

/** The signed `POST /v1/issues` route: files a reporter's feedback as a GitHub issue opened by the app. */
export function createIssueRoute(deps: CreateIssueDeps = {}): Route {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return {
    method: 'POST',
    path: /^\/v1\/issues$/,
    handler: async (req, env) => {
      const ipLimited = await rateLimited(env, ipScope(req), nowMs);
      if (ipLimited) return ipLimited;

      const authed = await authenticate(req, env, nowMs);
      if (authed instanceof Response) return authed;

      const parsed = parseJson(authed.body);
      if (!parsed.ok) return jsonError(400, 'bad_request', 'Request body must be valid JSON');
      const input = validateCreateIssueRequest(parsed.value);
      if ('error' in input) return jsonError(400, input.error, input.message);

      const issueLimited = await rateLimited(env, issueScope(authed.reporterId), nowMs);
      if (issueLimited) return issueLimited;

      const png = decodePngDataUrl(input.screenshot);
      if (typeof png === 'string')
        return jsonError(400, png, 'Screenshot is not an acceptable PNG');

      const screenshotUrl = await storeScreenshot(
        env.FEEDBACK_BUCKET,
        env.R2_PUBLIC_URL,
        png,
        nowMs,
      );
      const title = buildIssueTitle(input.text);
      const body = buildIssueBody({
        text: input.text,
        screenshotUrl,
        mossVersion: input.mossVersion,
        os: input.os,
        reporterId: authed.reporterId,
        githubHandle: input.githubHandle,
      });

      let issue: CreatedIssue;
      try {
        issue = await createIssue(env, { title, body, labels: [ISSUE_LABEL] }, deps.fetchImpl);
      } catch (err) {
        if (!(err instanceof GitHubError)) throw err;
        // A screenshot is only useful attached to an issue, so it does not outlive a failed create.
        await env.FEEDBACK_BUCKET.delete(screenshotKey(screenshotUrl));
        return jsonError(502, 'github_error', 'Could not create the GitHub issue');
      }

      const nowSeconds = Math.floor(nowMs() / 1000);
      try {
        await recordIssue(
          env.FEEDBACK_DB,
          { reporterId: authed.reporterId, pubKey: authed.pubKey },
          {
            number: issue.number,
            reporterId: authed.reporterId,
            title,
            createdAt: nowSeconds,
            createdVia: 'worker',
          },
        );
      } catch {
        // The issue already exists on GitHub and its body carries the reporter marker, so the
        // row can be rebuilt from GitHub later. Failing here would only invite a duplicate retry.
      }
      return jsonOk({ issueNumber: issue.number, issueUrl: issue.html_url }, 201);
    },
  };
}
