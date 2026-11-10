import { authenticate, type Authed } from '../auth';
import { getIssue, type StoredIssue } from '../db';
import type { Env } from '../env';
import { consume, ipScope, type RateScope } from '../rateLimit';
import { jsonError } from '../router';

export type IssueWriteDeps = { fetchImpl?: typeof fetch; nowMs?: () => number };

export type OwnedIssue = { authed: Authed; issue: StoredIssue };

/** Returns a 429 with `Retry-After` when the scope is over its limit, otherwise null. */
export async function rateLimited(
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

/**
 * Admits a signed request that acts on one issue only when the signer filed it. An issue the
 * worker does not track and one filed by someone else get the same 404, so the response never
 * reveals which issue numbers belong to other reporters.
 */
export async function ownedIssue(
  req: Request,
  env: Env,
  path: RegExp,
  nowMs: () => number,
): Promise<OwnedIssue | Response> {
  const ipLimited = await rateLimited(env, ipScope(req), nowMs);
  if (ipLimited) return ipLimited;

  const authed = await authenticate(req, env, nowMs);
  if (authed instanceof Response) return authed;

  const match = path.exec(new URL(req.url).pathname);
  const issue = match ? await getIssue(env.FEEDBACK_DB, Number(match[1])) : undefined;
  if (!issue || issue.reporterId !== authed.reporterId) {
    return jsonError(404, 'not_found', 'Issue not found');
  }
  return { authed, issue };
}

export function parseJson(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false };
  }
}
