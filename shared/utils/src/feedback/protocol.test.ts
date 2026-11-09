import { describe, it, expect } from 'vitest';
import {
  FEEDBACK_LIMITS,
  validateCreateIssueRequest,
  type CreateIssueRequest,
  type FeedbackErrorResponse,
} from './protocol.js';

const valid: CreateIssueRequest = {
  text: 'Something is off',
  screenshot: 'data:image/png;base64,iVBORw0KGgo=',
  mossVersion: '0.16.0',
  os: 'linux',
  githubHandle: 'octocat',
};

const errorOf = (req: unknown): string => (validateCreateIssueRequest(req) as FeedbackErrorResponse).error;

describe('validateCreateIssueRequest', () => {
  it('accepts a well formed request', () => {
    expect(validateCreateIssueRequest(valid)).toEqual(valid);
  });
  it('accepts a request without a github handle', () => {
    const { githubHandle: _h, ...rest } = valid;
    expect(validateCreateIssueRequest(rest)).toEqual(rest);
  });
  it('rejects non-objects and missing fields as bad_request', () => {
    expect(errorOf(null)).toBe('bad_request');
    expect(errorOf('x')).toBe('bad_request');
    expect(errorOf({ ...valid, mossVersion: undefined })).toBe('bad_request');
    expect(errorOf({ ...valid, os: 5 })).toBe('bad_request');
  });
  it('rejects whitespace-only text as bad_request', () => {
    expect(errorOf({ ...valid, text: '  \n\t ' })).toBe('bad_request');
  });
  it('rejects text over 10000 chars as text_too_long', () => {
    expect(errorOf({ ...valid, text: 'a'.repeat(10_001) })).toBe('text_too_long');
  });
  it('rejects a jpeg data url as screenshot_invalid', () => {
    expect(errorOf({ ...valid, screenshot: 'data:image/jpeg;base64,AAAA' })).toBe('screenshot_invalid');
  });
  it('rejects an oversize base64 payload as screenshot_too_large', () => {
    const max = Math.ceil(FEEDBACK_LIMITS.maxScreenshotBytes / 3) * 4;
    const screenshot = 'data:image/png;base64,' + 'A'.repeat(max + 4);
    expect(errorOf({ ...valid, screenshot })).toBe('screenshot_too_large');
  });
  it('rejects a github handle with a leading hyphen', () => {
    expect(errorOf({ ...valid, githubHandle: '-bad' })).toBe('bad_request');
  });
  it('exposes the spec limits', () => {
    expect(FEEDBACK_LIMITS.maxScreenshotBytes).toBe(2_097_152);
    expect(FEEDBACK_LIMITS.timestampWindowSeconds).toBe(300);
  });
});
