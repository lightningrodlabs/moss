import { describe, expect, it } from 'vitest';
import type { FeedbackSaveReason, FeedbackSubmitResult } from '../../electron-api';
import { isValidGithubHandle, noticeForResult, type SubmitNotice } from './submit-result';

const record: FeedbackSubmitResult['record'] = {
  id: 'r1',
  text: 'hi',
  mossVersion: '0.16.0',
  os: 'linux',
  timestamp: 1,
  state: 'local-only',
};

function saved(reason: FeedbackSaveReason): FeedbackSubmitResult {
  return { status: 'saved-locally', record, reason };
}

describe('noticeForResult', () => {
  it('maps a created issue to created', () => {
    expect(noticeForResult({ status: 'created', record })).toBe('created');
  });

  const cases: Array<[FeedbackSaveReason, SubmitNotice]> = [
    ['no-reporter-key', 'saved-locally-no-group'],
    ['stale_timestamp', 'saved-locally-clock'],
    ['rate_limited', 'saved-locally-rate-limited'],
    ['local-only', 'saved-locally'],
    ['no-worker-url', 'saved-locally'],
    ['unreachable', 'saved-locally'],
    ['rejected', 'saved-locally'],
    ['server_error', 'saved-locally'],
  ];
  it.each(cases)('maps saved-locally reason %s to %s', (reason, notice) => {
    expect(noticeForResult(saved(reason))).toBe(notice);
  });
});

describe('isValidGithubHandle', () => {
  it.each(['', 'octocat', 'a', 'a-b', 'A1', 'a'.repeat(39)])('accepts %j', (handle) => {
    expect(isValidGithubHandle(handle)).toBe(true);
  });

  it.each(['-bad', 'bad-', 'a b', 'a_b', '@octocat', 'a'.repeat(40)])('rejects %j', (handle) => {
    expect(isValidGithubHandle(handle)).toBe(false);
  });
});
