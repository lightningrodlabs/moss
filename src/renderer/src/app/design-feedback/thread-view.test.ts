import { describe, expect, it } from 'vitest';
import type { FeedbackActionResult, FeedbackRecordSummary } from '../../electron-api';
import {
  actionNotice,
  badgeText,
  cardTitle,
  hasThread,
  imagesToLinks,
  splitByState,
  type ActionNotice,
} from './thread-view';

function rec(
  id: string,
  timestamp: number,
  state: FeedbackRecordSummary['state'],
  extra: Partial<FeedbackRecordSummary> = {},
): FeedbackRecordSummary {
  return { id, text: `text ${id}`, mossVersion: '0.16.0', os: 'linux', timestamp, state, ...extra };
}

describe('imagesToLinks', () => {
  it('turns an image with alt text into a link', () => {
    expect(imagesToLinks('see ![shot](https://x/a.png) here')).toBe(
      'see [shot](https://x/a.png) here',
    );
  });

  it('labels an image without alt text as image', () => {
    expect(imagesToLinks('![](https://x/a.png)')).toBe('[image](https://x/a.png)');
  });

  it('leaves normal links alone', () => {
    const md = 'a [link](https://x/) and text!';
    expect(imagesToLinks(md)).toBe(md);
  });

  it('rewrites reference-style images', () => {
    expect(imagesToLinks('![pixel][r]\n\n[r]: https://x/p.png')).toBe(
      '[pixel][r]\n\n[r]: https://x/p.png',
    );
    expect(imagesToLinks('![][r]')).toBe('[image][r]');
  });

  it('rewrites collapsed and shortcut reference images', () => {
    expect(imagesToLinks('![r][] and ![r]\n\n[r]: https://x/p.png')).toBe(
      '[r][] and [r]\n\n[r]: https://x/p.png',
    );
  });

  it('tolerates one level of nested brackets in the alt text', () => {
    expect(imagesToLinks('![a [b] c](https://x/a.png)')).toBe('[a [b] c](https://x/a.png)');
    expect(imagesToLinks('![a [b]][r]')).toBe('[a [b]][r]');
  });

  it('converts every image in the text', () => {
    expect(imagesToLinks('![a](u1) ![](u2)')).toBe('[a](u1) [image](u2)');
  });
});

describe('splitByState', () => {
  it('puts open and local-only under open and closed under closed, newest first', () => {
    const records = [
      rec('a', 1, 'open'),
      rec('b', 3, 'local-only'),
      rec('c', 2, 'closed'),
      rec('d', 5, 'open'),
      rec('e', 4, 'closed'),
    ];
    const { open, closed } = splitByState(records);
    expect(open.map((r) => r.id)).toEqual(['d', 'b', 'a']);
    expect(closed.map((r) => r.id)).toEqual(['e', 'c']);
  });

  it('does not reorder the input array', () => {
    const records = [rec('a', 1, 'open'), rec('b', 2, 'open')];
    splitByState(records);
    expect(records.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('cardTitle', () => {
  it('prefers the issue title', () => {
    expect(cardTitle(rec('a', 1, 'open', { title: 'Issue title', text: 'body' }))).toBe(
      'Issue title',
    );
  });

  it('falls back to the first 60 characters of the text', () => {
    const text = 'x'.repeat(100);
    expect(cardTitle(rec('a', 1, 'local-only', { text }))).toBe('x'.repeat(60));
  });

  it('uses short text as is', () => {
    expect(cardTitle(rec('a', 1, 'local-only', { text: 'short' }))).toBe('short');
  });
});

describe('actionNotice', () => {
  const record = rec('a', 1, 'open');
  it('maps success to success', () => {
    expect(actionNotice({ ok: true, record })).toBe('success');
  });

  type Reason = Extract<FeedbackActionResult, { ok: false }>['reason'];
  const cases: Array<[Reason, ActionNotice]> = [
    ['conflict', 'already-closed'],
    ['rejected', 'rejected'],
    ['unreachable', 'unreachable'],
    ['server_error', 'unreachable'],
    ['no-worker-url', 'unreachable'],
    ['no-key', 'unreachable'],
    ['not-filed', 'unreachable'],
    ['stale_timestamp', 'unreachable'],
    ['rate_limited', 'unreachable'],
  ];
  it.each(cases)('maps %s to %s', (reason, notice) => {
    expect(actionNotice({ ok: false, reason })).toBe(notice);
  });
});

describe('badgeText', () => {
  it('shows counts up to nine and 9+ above', () => {
    expect(badgeText(1)).toBe('1');
    expect(badgeText(9)).toBe('9');
    expect(badgeText(10)).toBe('9+');
  });
});

describe('hasThread', () => {
  it('is true for a record filed through the phase 1 worker', () => {
    expect(hasThread(rec('a', 1, 'open', { issueNumber: 3, createdVia: 'worker' }))).toBe(true);
  });

  it('is false for a record the old worker filed, which has no createdVia', () => {
    expect(
      hasThread(
        rec('b', 1, 'open', { issueNumber: 3, issueUrl: 'https://github.com/o/r/issues/3' }),
      ),
    ).toBe(false);
  });

  it('is false for a local-only record', () => {
    expect(hasThread(rec('c', 1, 'local-only'))).toBe(false);
  });
});
