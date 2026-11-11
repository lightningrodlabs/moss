export const FEEDBACK_LIMITS = {
  issuesPerReporterPerHour: 10,
  commentsPerReporterPerHour: 60,
  requestsPerIpPerMinute: 30,
  maxScreenshotBytes: 2_097_152,
  maxTextChars: 10_000,
  /** Bound for single-line metadata such as mossVersion and os. */
  maxMetaChars: 200,
  /** Whole signed body: 2 MiB of PNG as base64 plus the text and metadata fields. */
  maxRequestBytes: 3_145_728,
  timestampWindowSeconds: 300,
  nonceTtlSeconds: 600,
  /** Sync adopts at most this many untracked issues from GitHub per request. */
  backfillsPerSyncRequest: 5,
  backfillsPerReporterPerHour: 30,
  /** Bounds the GitHub reads all reporters together can trigger through backfill. */
  backfillsPerHourGlobal: 200,
  /** How long a number that is not this reporter's issue is skipped before it is read again. */
  backfillMissTtlSeconds: 86_400,
  /**
   * The client asks for comments from this long before the last synced issue time, so
   * same-second writes and webhooks that land shortly after a sync are not skipped.
   */
  syncOverlapSeconds: 300,
} as const;

export type CreateIssueRequest = {
  text: string;
  /** data:image/png;base64,... */
  screenshot: string;
  mossVersion: string;
  os: string;
  githubHandle?: string;
};

export type CreateIssueResponse = { issueNumber: number; issueUrl: string };

export type FeedbackErrorCode =
  | 'bad_request'
  | 'invalid_signature'
  | 'stale_timestamp'
  | 'replayed_nonce'
  | 'rate_limited'
  | 'screenshot_invalid'
  | 'screenshot_too_large'
  | 'text_too_long'
  | 'github_error'
  | 'not_found'
  | 'conflict';

export type FeedbackErrorResponse = { error: FeedbackErrorCode; message: string };

const SCREENSHOT_PREFIX = 'data:image/png;base64,';
const SCREENSHOT_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const GITHUB_HANDLE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function fail(error: FeedbackErrorCode, message: string): FeedbackErrorResponse {
  return { error, message };
}

// Metadata is rendered into the issue body as single lines, so line breaks would let it forge structure.
function isSingleLineMeta(value: string): boolean {
  return value.length <= FEEDBACK_LIMITS.maxMetaChars && !/[\r\n]/.test(value);
}

/**
 * Checks an untrusted create-issue body so the worker only forwards
 * well-formed, size-bounded content to GitHub.
 */
export function validateCreateIssueRequest(req: unknown): CreateIssueRequest | FeedbackErrorResponse {
  if (typeof req !== 'object' || req === null || Array.isArray(req)) {
    return fail('bad_request', 'Request body must be a JSON object');
  }
  const r = req as Record<string, unknown>;
  const { text, screenshot, mossVersion, os, githubHandle } = r;
  if (typeof text !== 'string' || typeof screenshot !== 'string') {
    return fail('bad_request', 'text and screenshot must be strings');
  }
  if (typeof mossVersion !== 'string' || typeof os !== 'string') {
    return fail('bad_request', 'mossVersion and os must be strings');
  }
  if (!isSingleLineMeta(mossVersion) || !isSingleLineMeta(os)) {
    return fail(
      'bad_request',
      `mossVersion and os must be single lines of at most ${FEEDBACK_LIMITS.maxMetaChars} characters`,
    );
  }
  if (text.trim().length === 0) {
    return fail('bad_request', 'text must not be empty');
  }
  if (text.length > FEEDBACK_LIMITS.maxTextChars) {
    return fail('text_too_long', `text exceeds ${FEEDBACK_LIMITS.maxTextChars} characters`);
  }
  if (!SCREENSHOT_PATTERN.test(screenshot)) {
    return fail('screenshot_invalid', 'screenshot must be a PNG data URL');
  }
  const maxBase64Length = Math.ceil(FEEDBACK_LIMITS.maxScreenshotBytes / 3) * 4;
  if (screenshot.length - SCREENSHOT_PREFIX.length > maxBase64Length) {
    return fail('screenshot_too_large', `screenshot exceeds ${FEEDBACK_LIMITS.maxScreenshotBytes} bytes`);
  }
  if (githubHandle !== undefined) {
    if (typeof githubHandle !== 'string' || !GITHUB_HANDLE_PATTERN.test(githubHandle)) {
      return fail('bad_request', 'githubHandle is not a valid GitHub username');
    }
  }
  const out: CreateIssueRequest = { text, screenshot, mossVersion, os };
  if (githubHandle !== undefined) out.githubHandle = githubHandle;
  return out;
}
