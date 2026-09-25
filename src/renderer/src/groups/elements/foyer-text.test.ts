import { describe, expect, it } from 'vitest';

import { foyerMessageHtml } from './foyer-text.js';

describe('foyerMessageHtml', () => {
  it('escapes HTML', () => {
    expect(foyerMessageHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('links URLs', () => {
    expect(foyerMessageHtml('see https://example.org/x now')).toBe(
      'see <a style="text-decoration: underline;" href="https://example.org/x">https://example.org/x</a> now',
    );
  });

  it('shortens weave WAL links to the weave scheme', () => {
    expect(foyerMessageHtml('https://theweave.social/wal?weave-0.15://hrl/abc')).toBe(
      '<a style="text-decoration: underline;" href="weave-0.15://hrl/abc">weave-0.15://hrl/abc</a>',
    );
  });

  it('keeps line breaks, including after a link', () => {
    expect(foyerMessageHtml('one\ntwo')).toBe('one<br>two');
    expect(foyerMessageHtml('https://a.b/c\nnext')).toBe(
      '<a style="text-decoration: underline;" href="https://a.b/c">https://a.b/c</a><br>next',
    );
  });
});
