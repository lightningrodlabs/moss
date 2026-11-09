import { describe, expect, it } from 'vitest';
import {
  buildIssueBody,
  buildIssueTitle,
  parseReporterMarker,
  type IssueBodyInput,
} from './issueBody.js';

const input: IssueBodyInput = {
  text: 'The button is misaligned',
  screenshotUrl: 'https://example.com/s.png',
  mossVersion: '0.16.0',
  os: 'linux',
  reporterId: 'abcDEF123_-x',
};

describe('buildIssueBody', () => {
  it('includes reporter line and marker', () => {
    const body = buildIssueBody(input);
    expect(body).toContain('Reporter: `abcDEF123_-x`');
    expect(body.trimEnd().endsWith('<!-- moss-feedback reporter=abcDEF123_-x -->')).toBe(true);
  });

  it('orders sections as specified', () => {
    const body = buildIssueBody(input);
    const order = [
      '## Design Feedback',
      input.text,
      '### Screenshot',
      '![screenshot](https://example.com/s.png)',
      '### Environment',
      '0.16.0',
      'linux',
      'Reporter:',
      '---',
      '*Submitted via Moss Design Feedback Mode*',
      '<!-- moss-feedback',
    ];
    let last = -1;
    for (const part of order) {
      const idx = body.indexOf(part);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  it('omits the GitHub line without a handle and includes it with one', () => {
    expect(buildIssueBody(input)).not.toContain('GitHub:');
    expect(buildIssueBody({ ...input, githubHandle: 'octocat' })).toContain('GitHub: @octocat');
  });
});

describe('parseReporterMarker', () => {
  it('finds the id and returns undefined when absent', () => {
    expect(parseReporterMarker(buildIssueBody(input))).toBe('abcDEF123_-x');
    expect(parseReporterMarker('no marker here')).toBeUndefined();
  });
});

describe('buildIssueTitle', () => {
  it('keeps short text whole', () => {
    expect(buildIssueTitle('short')).toBe('[Design Feedback] short');
  });
  it('truncates over 60 chars with an ellipsis', () => {
    const title = buildIssueTitle('a'.repeat(100));
    expect(title).toBe('[Design Feedback] ' + 'a'.repeat(57) + '...');
  });
  it('does not truncate at exactly 60 chars', () => {
    expect(buildIssueTitle('b'.repeat(60))).toBe('[Design Feedback] ' + 'b'.repeat(60));
  });
});
