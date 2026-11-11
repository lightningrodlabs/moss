import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { FEEDBACK_LIMITS } from '../../../shared/utils/src/feedback/index.ts';
import { commentScope, consume, ipScope, issueScope } from '../src/rateLimit';

// 1_800_000_000 is a multiple of 3600 and 60, so it sits at the start of a window.
const WINDOW_START_MS = 1_800_000_000 * 1000;

describe('scopes', () => {
  it('uses the shared limits', () => {
    expect(issueScope('r')).toEqual({
      key: 'issues:r',
      limit: FEEDBACK_LIMITS.issuesPerReporterPerHour,
      windowSeconds: 3600,
    });
    expect(commentScope('r')).toEqual({
      key: 'comments:r',
      limit: FEEDBACK_LIMITS.commentsPerReporterPerHour,
      windowSeconds: 3600,
    });
  });

  it('keys the ip scope on CF-Connecting-IP', () => {
    const req = new Request('https://w/', { headers: { 'CF-Connecting-IP': '203.0.113.7' } });
    expect(ipScope(req)).toEqual({
      key: 'ip:203.0.113.7',
      limit: FEEDBACK_LIMITS.requestsPerIpPerMinute,
      windowSeconds: 60,
    });
  });

  it('falls back to ip:unknown without the header', () => {
    expect(ipScope(new Request('https://w/')).key).toBe('ip:unknown');
  });
});

describe('consume', () => {
  it('allows the 10th call and denies the 11th', async () => {
    const scope = issueScope('reporter-a');
    for (let i = 0; i < 10; i++) {
      expect((await consume(env.FEEDBACK_KV, scope, () => WINDOW_START_MS)).allowed).toBe(true);
    }
    expect((await consume(env.FEEDBACK_KV, scope, () => WINDOW_START_MS)).allowed).toBe(false);
  });

  it('resets in a new window', async () => {
    const scope = issueScope('reporter-b');
    for (let i = 0; i < 11; i++) await consume(env.FEEDBACK_KV, scope, () => WINDOW_START_MS);
    const next = await consume(env.FEEDBACK_KV, scope, () => WINDOW_START_MS + 3600 * 1000);
    expect(next.allowed).toBe(true);
  });

  it('reports the time until the window ends', async () => {
    const scope = issueScope('reporter-c');
    const res = await consume(env.FEEDBACK_KV, scope, () => WINDOW_START_MS + 1000 * 1000);
    expect(res.retryAfterSeconds).toBe(2600);
  });

  it('keeps scopes independent', async () => {
    for (let i = 0; i < 11; i++)
      await consume(env.FEEDBACK_KV, issueScope('reporter-d'), () => WINDOW_START_MS);
    const other = await consume(env.FEEDBACK_KV, issueScope('reporter-e'), () => WINDOW_START_MS);
    expect(other.allowed).toBe(true);
  });
});
