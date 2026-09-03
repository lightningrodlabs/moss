import { describe, it, expect } from 'vitest';
import { withUtf8Charset, withUtf8ContentType } from './assetCharset';

describe('withUtf8Charset', () => {
  it('adds charset=utf-8 to text-based types served without one', () => {
    expect(withUtf8Charset('text/javascript')).toBe('text/javascript; charset=utf-8');
    expect(withUtf8Charset('text/html')).toBe('text/html; charset=utf-8');
    expect(withUtf8Charset('text/css')).toBe('text/css; charset=utf-8');
    expect(withUtf8Charset('application/javascript')).toBe('application/javascript; charset=utf-8');
    expect(withUtf8Charset('application/json')).toBe('application/json; charset=utf-8');
  });

  it('keeps an explicit charset, whatever it is', () => {
    expect(withUtf8Charset('text/html; charset=utf-8')).toBe('text/html; charset=utf-8');
    expect(withUtf8Charset('text/html; charset=ISO-8859-1')).toBe('text/html; charset=ISO-8859-1');
    expect(withUtf8Charset('text/html;charset=utf-8')).toBe('text/html;charset=utf-8');
  });

  it('leaves binary types untouched', () => {
    expect(withUtf8Charset('application/wasm')).toBe('application/wasm');
    expect(withUtf8Charset('image/png')).toBe('image/png');
    expect(withUtf8Charset('font/woff2')).toBe('font/woff2');
    expect(withUtf8Charset('application/octet-stream')).toBe('application/octet-stream');
  });

  it('passes through a missing header', () => {
    expect(withUtf8Charset(null)).toBeNull();
    expect(withUtf8Charset(undefined)).toBeNull();
    expect(withUtf8Charset('')).toBeNull();
  });
});

describe('withUtf8ContentType', () => {
  it('rewrites the header and preserves body, status and other headers', async () => {
    const original = new Response('console.log(1)', {
      status: 200,
      headers: {
        'content-type': 'text/javascript',
        'last-modified': 'Sat, 28 Feb 2026 23:26:14 GMT',
      },
    });
    const fixed = withUtf8ContentType(original);
    expect(fixed.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(fixed.headers.get('last-modified')).toBe('Sat, 28 Feb 2026 23:26:14 GMT');
    expect(fixed.status).toBe(200);
    await expect(fixed.text()).resolves.toBe('console.log(1)');
  });

  it('returns the same response object when nothing needs to change', () => {
    const wasm = new Response(new Uint8Array([0, 0x61, 0x73, 0x6d]), {
      headers: { 'content-type': 'application/wasm' },
    });
    expect(withUtf8ContentType(wasm)).toBe(wasm);
  });
});
