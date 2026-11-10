/** GitHub webhook signature checking and the subset of event payloads the worker mirrors. */

export type GitHubIssuePayload = {
  number: number;
  state: 'open' | 'closed';
  state_reason: string | null;
  title: string;
  body: string | null;
  created_at: string;
  updated_at: string;
};

export type GitHubCommentPayload = {
  id: number;
  body: string;
  created_at: string;
  updated_at: string;
  user: { login: string };
  author_association: string;
};

export type WebhookEvent =
  | { kind: 'issue'; action: string; issue: GitHubIssuePayload }
  | {
      kind: 'comment';
      action: string;
      issue: GitHubIssuePayload;
      comment: GitHubCommentPayload;
    }
  | { kind: 'ignored' };

const SIGNATURE_PREFIX = 'sha256=';
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/;

function hexToBytes(hex: string): Uint8Array | undefined {
  if (!HEX_PATTERN.test(hex)) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Compares in time independent of where the inputs differ, so the MAC cannot be probed byte by byte. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Checks `X-Hub-Signature-256` (HMAC-SHA256 of the raw body, hex, `sha256=` prefixed). */
export async function verifyWebhookSignature(
  secret: string,
  body: Uint8Array,
  header: string | null,
): Promise<boolean> {
  if (header === null || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const claimed = hexToBytes(header.slice(SIGNATURE_PREFIX.length));
  if (!claimed) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, body as BufferSource));
  return constantTimeEqual(expected, claimed);
}

/** Seconds since the epoch for a GitHub ISO timestamp, or undefined when it does not parse. */
export function isoToSeconds(iso: string): number | undefined {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isTimestamp(v: unknown): v is string {
  return typeof v === 'string' && isoToSeconds(v) !== undefined;
}

function isId(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

function parseIssue(v: unknown): GitHubIssuePayload | undefined {
  if (!isObj(v)) return undefined;
  const { number, state, state_reason, title, body, created_at, updated_at } = v;
  if (!isId(number)) return undefined;
  if (state !== 'open' && state !== 'closed') return undefined;
  if (state_reason !== null && state_reason !== undefined && typeof state_reason !== 'string')
    return undefined;
  if (typeof title !== 'string') return undefined;
  if (body !== null && body !== undefined && typeof body !== 'string') return undefined;
  if (!isTimestamp(created_at) || !isTimestamp(updated_at)) return undefined;
  return {
    number,
    state,
    state_reason: state_reason ?? null,
    title,
    body: body ?? null,
    created_at,
    updated_at,
  };
}

function parseComment(v: unknown): GitHubCommentPayload | undefined {
  if (!isObj(v)) return undefined;
  const { id, body, created_at, updated_at, user, author_association } = v;
  if (!isId(id) || typeof body !== 'string') return undefined;
  if (!isTimestamp(created_at) || !isTimestamp(updated_at)) return undefined;
  if (!isObj(user) || typeof user.login !== 'string') return undefined;
  if (typeof author_association !== 'string') return undefined;
  return { id, body, created_at, updated_at, user: { login: user.login }, author_association };
}

/** Repository a delivery is about, as `owner/name`. */
export function deliveryRepository(payload: unknown): string | undefined {
  if (!isObj(payload) || !isObj(payload.repository)) return undefined;
  const name = payload.repository.full_name;
  return typeof name === 'string' ? name : undefined;
}

/**
 * Narrows a delivery to the issue and comment events the worker mirrors. Comments on pull
 * requests share the issue_comment event but never belong to a feedback thread.
 */
export function parseWebhookEvent(
  eventName: string | null,
  payload: unknown,
): WebhookEvent | 'bad_request' {
  if (eventName !== 'issues' && eventName !== 'issue_comment') return { kind: 'ignored' };
  if (!isObj(payload) || typeof payload.action !== 'string') return 'bad_request';
  const { action } = payload;
  if (isObj(payload.issue) && payload.issue.pull_request !== undefined) return { kind: 'ignored' };
  const issue = parseIssue(payload.issue);
  if (!issue) return 'bad_request';
  if (eventName === 'issues') return { kind: 'issue', action, issue };
  const comment = parseComment(payload.comment);
  if (!comment) return 'bad_request';
  return { kind: 'comment', action, issue, comment };
}
