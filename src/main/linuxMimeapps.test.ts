import { describe, it, expect } from 'vitest';
import { withoutMossHtmlHandler } from './linuxMimeapps';

describe('withoutMossHtmlHandler', () => {
  it('drops a text/html default that names a Moss desktop entry', () => {
    const before = [
      '[Default Applications]',
      'text/html=org.lightningrodlabs.moss-0.15.desktop',
      'x-scheme-handler/weave-0.15=org.lightningrodlabs.moss-0.15.desktop',
      '',
    ].join('\n');
    expect(withoutMossHtmlHandler(before)).toBe(
      [
        '[Default Applications]',
        'x-scheme-handler/weave-0.15=org.lightningrodlabs.moss-0.15.desktop',
        '',
      ].join('\n'),
    );
  });

  it('removes only the Moss entries from a text/html handler list', () => {
    const before = [
      '[Added Associations]',
      'text/html=org.lightningrodlabs.moss-0.15.desktop;firefox.desktop;org.lightningrodlabs.moss-0.14.desktop;',
    ].join('\n');
    expect(withoutMossHtmlHandler(before)).toBe(
      ['[Added Associations]', 'text/html=firefox.desktop;'].join('\n'),
    );
  });

  it('returns null when no text/html line names Moss', () => {
    const content = [
      '[Default Applications]',
      'text/html=firefox.desktop',
      'x-scheme-handler/weave-0.16=org.lightningrodlabs.moss-0.16.desktop',
    ].join('\n');
    expect(withoutMossHtmlHandler(content)).toBeNull();
  });

  it('leaves non-html Moss entries and other mime types alone', () => {
    const content = [
      '[Default Applications]',
      'x-scheme-handler/weave-0.16=org.lightningrodlabs.moss-0.16.desktop',
      'text/plain=org.lightningrodlabs.moss-0.16.desktop',
    ].join('\n');
    expect(withoutMossHtmlHandler(content)).toBeNull();
  });

  it('preserves CRLF-free files byte for byte apart from the removed entries', () => {
    const before =
      '[Default Applications]\ntext/html=org.lightningrodlabs.moss-0.15.desktop\n\n[Other]\nk=v\n';
    expect(withoutMossHtmlHandler(before)).toBe('[Default Applications]\n\n[Other]\nk=v\n');
  });
});
