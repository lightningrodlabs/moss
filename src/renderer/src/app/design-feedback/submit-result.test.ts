import { describe, expect, it } from 'vitest';
import type { FeedbackSaveReason, FeedbackSubmitResult } from '../../electron-api';
import { FEEDBACK_LIMITS } from '@theweave/utils';
import {
  isScreenshotTooLarge,
  isValidGithubHandle,
  noticeForResult,
  screenshotDecodedBytes,
  type SubmitNotice,
} from './submit-result';

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
    ['rejected', 'saved-locally-rejected'],
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

describe('screenshotDecodedBytes', () => {
  it.each([
    ['', 0],
    ['AAAA', 3],
    ['AAA=', 2],
    ['AA==', 1],
    ['iVBORw0KGgo=', 8],
  ])('decodes base64 %j to %d bytes', (payload, bytes) => {
    expect(screenshotDecodedBytes(`data:image/png;base64,${payload}`)).toBe(bytes);
  });
});

describe('isScreenshotTooLarge', () => {
  // The limit is not a multiple of 3, so whole groups get close and a padded tail lands on it.
  const wholeGroups = Math.floor(FEEDBACK_LIMITS.maxScreenshotBytes / 3);
  const dataUrl = (tail: string): string =>
    'data:image/png;base64,' + 'A'.repeat(wholeGroups * 4) + tail;

  it('accepts a screenshot of exactly the limit', () => {
    expect(screenshotDecodedBytes(dataUrl('AAA='))).toBe(FEEDBACK_LIMITS.maxScreenshotBytes);
    expect(isScreenshotTooLarge(dataUrl('AAA='))).toBe(false);
  });
  it('rejects a screenshot one byte over the limit', () => {
    expect(screenshotDecodedBytes(dataUrl('AAAA'))).toBe(FEEDBACK_LIMITS.maxScreenshotBytes + 1);
    expect(isScreenshotTooLarge(dataUrl('AAAA'))).toBe(true);
  });
  it('treats a missing screenshot as not too large', () => {
    expect(isScreenshotTooLarge('')).toBe(false);
  });
});
