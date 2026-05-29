import { describe, it, expect } from 'vitest';
import {
  assertPublicHost,
  frameAncestorsBlocks,
  hasImageExtension,
  imageContentAccepted,
  isDataImageUrl,
  isPrivateIp,
} from './mediaUrlValidation';

describe('isDataImageUrl', () => {
  it('accepts data:image URLs (any case)', () => {
    expect(isDataImageUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isDataImageUrl('  DATA:IMAGE/svg+xml,<svg/>')).toBe(true);
  });
  it('rejects non-image data URLs and other schemes', () => {
    expect(isDataImageUrl('data:text/html,<b>x</b>')).toBe(false);
    expect(isDataImageUrl('https://example.com/a.png')).toBe(false);
  });
});

describe('isPrivateIp', () => {
  it('flags loopback / private / link-local IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.5',
      '169.254.1.1',
      '0.0.0.0',
      '100.64.0.1',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
  it('flags loopback / unique-local / link-local IPv6 and v4-mapped private', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it('allows public IPv6', () => {
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
  });
  it('treats a non-IP string as unsafe (caller must resolve via DNS)', () => {
    expect(isPrivateIp('example.com')).toBe(true);
  });
});

describe('assertPublicHost (no-DNS branches)', () => {
  it('rejects localhost and *.localhost', async () => {
    await expect(assertPublicHost('localhost')).rejects.toThrow('private-host');
    await expect(assertPublicHost('app.localhost')).rejects.toThrow('private-host');
  });
  it('rejects literal private IPs (incl. bracketed IPv6)', async () => {
    await expect(assertPublicHost('127.0.0.1')).rejects.toThrow('private-host');
    await expect(assertPublicHost('192.168.1.1')).rejects.toThrow('private-host');
    await expect(assertPublicHost('[::1]')).rejects.toThrow('private-host');
  });
  it('accepts literal public IPs without touching DNS', async () => {
    await expect(assertPublicHost('8.8.8.8')).resolves.toBeUndefined();
    await expect(assertPublicHost('[2606:4700:4700::1111]')).resolves.toBeUndefined();
  });
});

describe('hasImageExtension', () => {
  it('matches common image extensions', () => {
    for (const p of ['/a/b/emergence_icon.png', '/x.JPG', '/y.jpeg', '/z.svg', '/w.webp', '/v.avif']) {
      expect(hasImageExtension(p), p).toBe(true);
    }
  });
  it('does not match non-image or extensionless paths', () => {
    for (const p of ['/download/asset', '/page.html', '/a.png.exe', '/release/v0.5.0']) {
      expect(hasImageExtension(p), p).toBe(false);
    }
  });
});

describe('imageContentAccepted', () => {
  it('accepts a real image/* content-type regardless of path', () => {
    expect(imageContentAccepted('image/png', '/download/asset')).toBe(true);
    expect(imageContentAccepted('image/svg+xml; charset=utf-8', '/x')).toBe(true);
  });
  it('accepts a generic-binary type when the path has an image extension (GitHub release assets)', () => {
    expect(
      imageContentAccepted('application/octet-stream', '/releases/download/v0.5.0/emergence_icon.png'),
    ).toBe(true);
    expect(imageContentAccepted('', '/icon.webp')).toBe(true);
  });
  it('rejects a generic-binary type without an image extension', () => {
    expect(imageContentAccepted('application/octet-stream', '/releases/download/v0.5.0/tool.happ')).toBe(
      false,
    );
  });
  it('rejects an HTML error page even when the path ends in .png', () => {
    expect(imageContentAccepted('text/html', '/x.png')).toBe(false);
  });
});

describe('frameAncestorsBlocks', () => {
  it('returns false when the directive is absent or no CSP header', () => {
    expect(frameAncestorsBlocks(null)).toBe(false);
    expect(frameAncestorsBlocks('default-src https:')).toBe(false);
  });
  it("blocks 'none' and specific allowlists", () => {
    expect(frameAncestorsBlocks("frame-ancestors 'none'")).toBe(true);
    expect(frameAncestorsBlocks('frame-ancestors https://trusted.example')).toBe(true);
    expect(frameAncestorsBlocks("default-src 'self'; frame-ancestors 'self'")).toBe(true);
  });
  it('allows a wildcard allowlist', () => {
    expect(frameAncestorsBlocks('frame-ancestors *')).toBe(false);
    expect(frameAncestorsBlocks('frame-ancestors https: *')).toBe(false);
  });
});
