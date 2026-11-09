import { randomBytes } from 'node:crypto';
import {
  buildSignedHeaders,
  type CreateIssueRequest,
  type CreateIssueResponse,
  type FeedbackErrorResponse,
} from '@theweave/utils';
import type { ReporterKey } from './reporterKey';

const ISSUES_PATH = '/v1/issues';
const DEFAULT_TIMEOUT_MS = 30_000;

export type WorkerFailureReason =
  | 'unreachable'
  | 'stale_timestamp'
  | 'rate_limited'
  | 'rejected'
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

  async createIssue(req: CreateIssueRequest): Promise<WorkerResult<CreateIssueResponse>> {
    const bodyText = JSON.stringify(req);
    const signed = await buildSignedHeaders({
      method: 'POST',
      path: ISSUES_PATH,
      body: new TextEncoder().encode(bodyText),
      pubKey: this.key.publicKey,
      nonce: this.randomNonce(),
      nowSeconds: Math.floor(this.now() / 1000),
      sign: this.key.sign,
    });

    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${ISSUES_PATH}`, {
        method: 'POST',
        headers: { ...signed, 'Content-Type': 'application/json' },
        body: bodyText,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      return { ok: false, reason: 'unreachable', message: e instanceof Error ? e.message : String(e) };
    }

    const parsed = await readJson(res);
    if (res.status >= 200 && res.status < 300) {
      if (isCreateIssueResponse(parsed)) return { ok: true, value: parsed };
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
    if (res.status === 429) return { ...base, reason: 'rate_limited' };
    if (res.status >= 500) return { ...base, reason: 'server_error' };
    return { ...base, reason: 'rejected' };
  }
}
