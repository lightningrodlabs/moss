import { randomBytes } from 'node:crypto';
import {
  buildSignedHeaders,
  type CreateIssueRequest,
  type CreateIssueResponse,
  type FeedbackErrorResponse,
  type ReplyRequest,
  type ReplyResponse,
  type ResolveResponse,
  type SyncRequest,
  type SyncResponse,
} from '@theweave/utils';
import type { ReporterKey } from './reporterKey';

const ISSUES_PATH = '/v1/issues';
const SYNC_PATH = '/v1/sync';
const DEFAULT_TIMEOUT_MS = 30_000;

export type WorkerFailureReason =
  | 'unreachable'
  | 'stale_timestamp'
  | 'rate_limited'
  | 'rejected'
  | 'conflict'
  | 'server_error';

export type WorkerResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: WorkerFailureReason; status?: number; message?: string };

export type FeedbackWorkerClientDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  randomNonce?: () => Uint8Array;
  timeoutMs?: number;
};

function isCreateIssueResponse(v: unknown): v is CreateIssueResponse {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.issueNumber === 'number' && typeof r.issueUrl === 'string';
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isWireComment(v: unknown): boolean {
  return (
    isRecord(v) &&
    isInt(v.id) &&
    typeof v.authorLogin === 'string' &&
    typeof v.authorAssociation === 'string' &&
    typeof v.body === 'string' &&
    typeof v.postedForReporter === 'boolean' &&
    typeof v.deleted === 'boolean' &&
    isInt(v.createdAt) &&
    isInt(v.updatedAt)
  );
}

function isSyncResponse(v: unknown): v is SyncResponse {
  if (!isRecord(v) || !Array.isArray(v.issues)) return false;
  return v.issues.every(
    (i) =>
      isRecord(i) &&
      isInt(i.number) &&
      (i.state === 'open' || i.state === 'closed') &&
      typeof i.title === 'string' &&
      isInt(i.updatedAt) &&
      Array.isArray(i.comments) &&
      i.comments.every(isWireComment),
  );
}

function isReplyResponse(v: unknown): v is ReplyResponse {
  return isRecord(v) && isInt(v.commentId) && isInt(v.createdAt);
}

function isResolveResponse(v: unknown): v is ResolveResponse {
  return isRecord(v) && v.state === 'closed' && isInt(v.closedAt);
}

function issuePath(issueNumber: number, action: 'comments' | 'resolve'): string {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new TypeError(`issueNumber must be a positive integer, got ${issueNumber}`);
  }
  return `${ISSUES_PATH}/${issueNumber}/${action}`;
}

function asErrorResponse(v: unknown): Partial<FeedbackErrorResponse> {
  if (typeof v !== 'object' || v === null) return {};
  const r = v as Record<string, unknown>;
  return {
    error: typeof r.error === 'string' ? (r.error as FeedbackErrorResponse['error']) : undefined,
    message: typeof r.message === 'string' ? r.message : undefined,
  };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * Posts signed feedback requests to the worker and classifies failures so the
 * caller can tell the user why the report was only saved locally.
 */
export class FeedbackWorkerClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly randomNonce: () => Uint8Array;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    private readonly key: ReporterKey,
    deps: FeedbackWorkerClientDeps = {},
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchFn = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.randomNonce = deps.randomNonce ?? (() => new Uint8Array(randomBytes(16)));
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  createIssue(req: CreateIssueRequest): Promise<WorkerResult<CreateIssueResponse>> {
    return this.signedPost(ISSUES_PATH, req, isCreateIssueResponse);
  }

  sync(req: SyncRequest): Promise<WorkerResult<SyncResponse>> {
    return this.signedPost(SYNC_PATH, req, isSyncResponse);
  }

  async reply(issueNumber: number, req: ReplyRequest): Promise<WorkerResult<ReplyResponse>> {
    return this.signedPost(issuePath(issueNumber, 'comments'), req, isReplyResponse);
  }

  async resolve(issueNumber: number): Promise<WorkerResult<ResolveResponse>> {
    return this.signedPost(issuePath(issueNumber, 'resolve'), {}, isResolveResponse);
  }

  private async signedPost<T>(
    path: string,
    body: unknown,
    isT: (v: unknown) => v is T,
  ): Promise<WorkerResult<T>> {
    const bodyText = JSON.stringify(body);
    const signed = await buildSignedHeaders({
      method: 'POST',
      path,
      body: new TextEncoder().encode(bodyText),
      pubKey: this.key.publicKey,
      nonce: this.randomNonce(),
      nowSeconds: Math.floor(this.now() / 1000),
      sign: this.key.sign,
    });

    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { ...signed, 'Content-Type': 'application/json' },
        body: bodyText,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      return {
        ok: false,
        reason: 'unreachable',
        message: e instanceof Error ? e.message : String(e),
      };
    }

    const parsed = await readJson(res);
    if (res.status >= 200 && res.status < 300) {
      if (isT(parsed)) return { ok: true, value: parsed };
      return {
        ok: false,
        reason: 'server_error',
        status: res.status,
        message: 'Unexpected response from the feedback service',
      };
    }

    const err = asErrorResponse(parsed);
    const base = { ok: false, status: res.status, message: err.message } as const;
    if (res.status === 401 && err.error === 'stale_timestamp') {
      return { ...base, reason: 'stale_timestamp' };
    }
    if (res.status === 409) return { ...base, reason: 'conflict' };
    if (res.status === 429) return { ...base, reason: 'rate_limited' };
    if (res.status >= 500) return { ...base, reason: 'server_error' };
    return { ...base, reason: 'rejected' };
  }
}
