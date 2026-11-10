import {
  FEEDBACK_LIMITS,
  parseReporterMarker,
} from '../../../../shared/utils/src/feedback/index.ts';
import {
  deleteIssue,
  getComment,
  getIssue,
  reporterExists,
  softDeleteComment,
  touchIssue,
  upsertComment,
  upsertIssue,
  type StoredIssue,
} from '../db';
import type { Env } from '../env';
import { jsonError, type Route } from '../router';
import {
  deliveryRepository,
  isoToSeconds,
  parseWebhookEvent,
  verifyWebhookSignature,
  type GitHubCommentPayload,
  type GitHubIssuePayload,
} from '../webhook';

export type WebhookDeps = { nowMs?: () => number };

// GitHub only needs a 2xx; every accepted or ignored delivery gets the same empty answer.
function accepted(): Response {
  return new Response(null, { status: 204 });
}

function requestTooLarge(): Response {
  return jsonError(
    413,
    'bad_request',
    `Request body exceeds ${FEEDBACK_LIMITS.maxRequestBytes} bytes`,
  );
}

/** Reads the body once, bounded in size, before anything else looks at it. */
async function readBody(req: Request): Promise<Uint8Array | Response> {
  const declaredLength = req.headers.get('Content-Length');
  if (declaredLength !== null && Number(declaredLength) > FEEDBACK_LIMITS.maxRequestBytes) {
    return requestTooLarge();
  }
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > FEEDBACK_LIMITS.maxRequestBytes) return requestTooLarge();
  return body;
}

function parseJson(bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false };
  }
}

/** GitHub's view of an issue, keeping the reporter, origin and creation time already stored. */
function mirrored(issue: GitHubIssuePayload, base: StoredIssue): StoredIssue {
  const row: StoredIssue = {
    number: issue.number,
    reporterId: base.reporterId,
    state: issue.state,
    title: issue.title,
    createdAt: base.createdAt,
    // Deliveries can arrive out of order, so a stale one never rewinds the update time.
    updatedAt: Math.max(base.updatedAt, isoToSeconds(issue.updated_at) ?? base.updatedAt),
    createdVia: base.createdVia,
  };
  if (issue.state_reason !== null) row.stateReason = issue.state_reason;
  return row;
}

/**
 * The stored issue, first adopting an untracked one whose body names a known reporter.
 * Undefined means the delivery is not about a feedback thread this worker can track yet.
 */
async function trackedIssue(
  db: D1Database,
  issue: GitHubIssuePayload,
): Promise<StoredIssue | undefined> {
  const stored = await getIssue(db, issue.number);
  if (stored) return stored;
  const reporterId = parseReporterMarker(issue.body ?? '');
  // An unknown reporter is skipped: sync backfills the issue once that reporter appears.
  if (reporterId === undefined || !(await reporterExists(db, reporterId))) return undefined;
  const createdAt = isoToSeconds(issue.created_at) ?? 0;
  const adopted = mirrored(issue, {
    number: issue.number,
    reporterId,
    state: issue.state,
    title: issue.title,
    createdAt,
    updatedAt: createdAt,
    createdVia: 'github',
  });
  await upsertIssue(db, adopted);
  return adopted;
}

async function handleIssue(db: D1Database, action: string, issue: GitHubIssuePayload) {
  if (action === 'deleted') {
    if (await getIssue(db, issue.number)) await deleteIssue(db, issue.number);
    return;
  }
  const stored = await trackedIssue(db, issue);
  if (stored) await upsertIssue(db, mirrored(issue, stored));
}

async function handleComment(
  db: D1Database,
  action: string,
  issue: GitHubIssuePayload,
  comment: GitHubCommentPayload,
  nowSeconds: number,
) {
  if (!(await trackedIssue(db, issue))) return;
  if (action === 'deleted') {
    await softDeleteComment(db, comment.id, nowSeconds);
    await touchIssue(db, issue.number, nowSeconds);
    return;
  }
  if (action !== 'created' && action !== 'edited') return;
  // A deletion is final; a late or redelivered edit must not bring the comment back.
  const existing = await getComment(db, comment.id);
  if (existing?.deletedAt !== undefined) return;
  const updatedAt = isoToSeconds(comment.updated_at) ?? nowSeconds;
  await upsertComment(db, {
    id: comment.id,
    issueNumber: issue.number,
    authorLogin: comment.user.login,
    authorAssociation: comment.author_association,
    postedForReporter: false,
    body: comment.body,
    createdAt: isoToSeconds(comment.created_at) ?? updatedAt,
    updatedAt,
  });
  await touchIssue(db, issue.number, updatedAt);
}

/** The `POST /v1/webhook` route: mirrors this environment's repository issues and comments into D1. */
export function webhookRoute(deps: WebhookDeps = {}): Route {
  const nowMs = deps.nowMs ?? (() => Date.now());
  return {
    method: 'POST',
    path: /^\/v1\/webhook$/,
    handler: async (req, env: Env) => {
      const body = await readBody(req);
      if (body instanceof Response) return body;
      const signature = req.headers.get('X-Hub-Signature-256');
      if (!(await verifyWebhookSignature(env.WEBHOOK_SECRET, body, signature))) {
        return jsonError(401, 'invalid_signature', 'Webhook signature is invalid');
      }

      const parsed = parseJson(body);
      if (!parsed.ok) return jsonError(400, 'bad_request', 'Request body must be valid JSON');
      // Each environment has its own repository webhook; another repository's delivery is not ours.
      if (deliveryRepository(parsed.value) !== `${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`) {
        return accepted();
      }

      const event = parseWebhookEvent(req.headers.get('X-GitHub-Event'), parsed.value);
      if (event === 'bad_request') {
        return jsonError(400, 'bad_request', 'Malformed webhook payload');
      }
      const db = env.FEEDBACK_DB;
      if (event.kind === 'issue') await handleIssue(db, event.action, event.issue);
      if (event.kind === 'comment') {
        const nowSeconds = Math.floor(nowMs() / 1000);
        await handleComment(db, event.action, event.issue, event.comment, nowSeconds);
      }
      return accepted();
    },
  };
}
