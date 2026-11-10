import { describe, expect, it } from 'vitest';
import { THREAD_MARKDOWN_SANITIZE } from './thread-sanitize';

describe('THREAD_MARKDOWN_SANITIZE', () => {
  const fetching = [
    'img',
    'picture',
    'source',
    'video',
    'audio',
    'iframe',
    'object',
    'embed',
    'style',
    'svg',
    'image',
    'math',
    'link',
    'input',
    'table',
    'td',
  ];

  it.each(fetching)('does not allow the %s tag', (tag) => {
    expect(THREAD_MARKDOWN_SANITIZE.ALLOWED_TAGS).not.toContain(tag);
  });

  it('allows only the href attribute', () => {
    expect(THREAD_MARKDOWN_SANITIZE.ALLOWED_ATTR).toEqual(['href']);
  });

  it('allows neither data attributes nor unknown protocols', () => {
    expect(THREAD_MARKDOWN_SANITIZE.ALLOW_DATA_ATTR).toBe(false);
    expect(THREAD_MARKDOWN_SANITIZE.ALLOW_UNKNOWN_PROTOCOLS).toBe(false);
  });
});
