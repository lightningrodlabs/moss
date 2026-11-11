import { FEEDBACK_LIMITS } from '../../../shared/utils/src/feedback/index.ts';

export type RateScope = { key: string; limit: number; windowSeconds: number };

export function ipScope(req: Request): RateScope {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  return { key: `ip:${ip}`, limit: FEEDBACK_LIMITS.requestsPerIpPerMinute, windowSeconds: 60 };
}

export function issueScope(reporterId: string): RateScope {
  return {
    key: `issues:${reporterId}`,
    limit: FEEDBACK_LIMITS.issuesPerReporterPerHour,
    windowSeconds: 3600,
  };
}

export function commentScope(reporterId: string): RateScope {
  return {
    key: `comments:${reporterId}`,
    limit: FEEDBACK_LIMITS.commentsPerReporterPerHour,
    windowSeconds: 3600,
  };
}

/**
 * Counts one request against a fixed window and reports whether it is within the limit.
 * `nowMs` is a clock in milliseconds (default `Date.now`); windows are computed in seconds.
 * KV is not atomic, so concurrent requests can slightly undercount; the limits are abuse
 * guards, not exact quotas.
 */
export async function consume(
  kv: KVNamespace,
  scope: RateScope,
  nowMs: () => number = () => Date.now(),
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const nowSeconds = Math.floor(nowMs() / 1000);
  const window = Math.floor(nowSeconds / scope.windowSeconds);
  const key = `${scope.key}:${window}`;
  const count = Number((await kv.get(key)) ?? '0') + 1;
  await kv.put(key, String(count), { expirationTtl: scope.windowSeconds * 2 });
  return {
    allowed: count <= scope.limit,
    retryAfterSeconds: (window + 1) * scope.windowSeconds - nowSeconds,
  };
}
