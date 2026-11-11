import { createExecutionContext, env } from 'cloudflare:test';
import { recordIssue } from '../src/db';
import { route, type Route } from '../src/router';
import type { TestReporter } from './sign';

export const NOW_MS = 1_800_000_000_000;
export const COMMENT_ISO = '2026-11-10T10:00:00Z';
export const CLOSED_ISO = '2026-11-10T10:00:05Z';
export const COMMENT_SEC = Math.floor(Date.parse(COMMENT_ISO) / 1000);
export const CLOSED_SEC = Math.floor(Date.parse(CLOSED_ISO) / 1000);
export const COMMENT_ID = 9001;
const enc = new TextEncoder();

export type Call = { method: string; url: string; body: unknown };

/**
 * Fake GitHub for the write routes: issues tokens, answers comment creation and issue close,
 * and records every call. `failWith` makes the matching write respond with that status.
 */
export function fakeGitHub(failWith: { comment?: number; close?: number } = {}): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (url.endsWith('/access_tokens')) {
      return Response.json(
        { token: 'tok', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
        { status: 201 },
      );
    }
    const m = /\/issues\/(\d+)(\/comments)?$/.exec(url);
    if (m && m[2] && method === 'POST') {
      if (failWith.comment)
        return new Response('upstream secret detail', { status: failWith.comment });
      const text = (body as { body: string }).body;
      return Response.json(
        {
          id: COMMENT_ID,
          body: text,
          created_at: COMMENT_ISO,
          updated_at: COMMENT_ISO,
          user: { login: 'moss-feedback[bot]' },
          author_association: 'NONE',
        },
        { status: 201 },
      );
    }
    if (m && !m[2] && method === 'PATCH') {
      if (failWith.close) return new Response('upstream secret detail', { status: failWith.close });
      return Response.json({
        number: Number(m[1]),
        state: 'closed',
        state_reason: 'completed',
        title: 'Mine',
        body: 'b',
        created_at: COMMENT_ISO,
        updated_at: CLOSED_ISO,
        html_url: `https://github.com/o/r/issues/${m[1]}`,
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** Calls that reached the repository, excluding installation token requests. */
export function repoCalls(calls: Call[]): Call[] {
  return calls.filter((c) => !c.url.endsWith('/access_tokens'));
}

let ipCounter = 0;

export async function signedPost(
  reporter: TestReporter,
  path: string,
  body: string,
): Promise<Request> {
  ipCounter++;
  const headers = await reporter.sign({
    method: 'POST',
    path,
    body: enc.encode(body),
    nowSeconds: NOW_MS / 1000,
  });
  return new Request(`https://w${path}`, {
    method: 'POST',
    headers: {
      ...headers,
      'CF-Connecting-IP': `10.2.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
    },
    body,
  });
}

export function call(req: Request, r: Route): Promise<Response> {
  return route(req, [r], env, createExecutionContext());
}

export async function track(
  reporterId: string,
  pubKey: Uint8Array,
  number: number,
  state: 'open' | 'closed' = 'open',
): Promise<void> {
  await recordIssue(
    env.FEEDBACK_DB,
    { reporterId, pubKey },
    { number, reporterId, title: 'Mine', createdAt: 100, createdVia: 'worker' },
  );
  if (state === 'closed') {
    await env.FEEDBACK_DB.prepare("UPDATE issues SET state = 'closed' WHERE number = ?")
      .bind(number)
      .run();
  }
}

export async function clearTables(): Promise<void> {
  const db = env.FEEDBACK_DB;
  await db.batch([
    db.prepare('DELETE FROM comments'),
    db.prepare('DELETE FROM issues'),
    db.prepare('DELETE FROM reporters'),
  ]);
}

export async function count(table: 'issues' | 'comments'): Promise<number> {
  const row = await env.FEEDBACK_DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
    n: number;
  }>();
  return row?.n ?? 0;
}
