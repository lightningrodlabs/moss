import type { FeedbackSubmitResult } from '../../electron-api';

/** Which user-facing notice a feedback submission outcome should produce. */
export type SubmitNotice =
  | 'created'
  | 'saved-locally'
  | 'saved-locally-no-group'
  | 'saved-locally-clock'
  | 'saved-locally-rate-limited';

/**
 * Picks the notice for a submission outcome. Only reasons the user can act on
 * get their own notice; every other failure reads as "could not reach".
 */
export function noticeForResult(result: FeedbackSubmitResult): SubmitNotice {
  if (result.status === 'created') return 'created';
  switch (result.reason) {
    case 'no-reporter-key':
      return 'saved-locally-no-group';
    case 'stale_timestamp':
      return 'saved-locally-clock';
    case 'rate_limited':
      return 'saved-locally-rate-limited';
    default:
      return 'saved-locally';
  }
}

/** Same pattern the feedback worker enforces in shared/utils/src/feedback/protocol.ts. */
const GITHUB_HANDLE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** An empty handle is valid because the field is optional. */
export function isValidGithubHandle(handle: string): boolean {
  return handle === '' || GITHUB_HANDLE_PATTERN.test(handle);
}
