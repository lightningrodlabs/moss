import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { validateMediaUrl } from './mediaUrlProbe';

// The SSRF resolver intentionally rejects loopback, which is the only address a
// local test server can bind to. Its own logic is covered by
// mediaUrlValidation.test.ts; here we inject a stub so the REAL http probe, the
// node `lookup` contract, and redirect handling run against a loopback server:
// `internal*` hostnames are treated as private (rejected), everything else pins
// to 127.0.0.1.
const stubResolve = async (hostname: string) => {
  if (hostname.startsWith('internal')) throw new Error('private-host');
  return { address: '127.0.0.1', family: 4 };
};

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    switch (req.url) {
      case '/image.png':
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end('PNGDATA');
      case '/page.html':
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<html></html>');
      case '/frame-denied':
        res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' });
        return res.end('<html></html>');
      case '/redirect-public':
        res.writeHead(302, { location: `http://public.test:${port}/image.png` });
        return res.end();
      case '/redirect-internal':
        res.writeHead(302, { location: `http://internal.test:${port}/image.png` });
        return res.end();
      case '/redirect-loop':
        res.writeHead(302, { location: `http://public.test:${port}/redirect-loop` });
        return res.end();
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
});

const url = (path: string) => `http://public.test:${port}${path}`;

describe('validateMediaUrl (probe over a real loopback server)', () => {
  it('accepts an image served with an image/* content-type', async () => {
    // Regression guard: exercises the node `lookup` callback, which must honor
    // `options.all` (autoSelectFamily) by returning an array — returning a bare
    // (address, family) crashes every request with ERR_INVALID_IP_ADDRESS.
    expect(await validateMediaUrl(url('/image.png'), 'image', stubResolve)).toEqual({
      ok: true,
      contentType: 'image/png',
    });
  });

  it('rejects an HTML page for an image tile', async () => {
    expect(await validateMediaUrl(url('/page.html'), 'image', stubResolve)).toEqual({
      ok: false,
      reason: 'not-an-image',
    });
  });

  it('follows a redirect to a public host', async () => {
    expect(await validateMediaUrl(url('/redirect-public'), 'image', stubResolve)).toEqual({
      ok: true,
      contentType: 'image/png',
    });
  });

  it('re-validates each hop and rejects a redirect to a private host', async () => {
    expect(await validateMediaUrl(url('/redirect-internal'), 'image', stubResolve)).toEqual({
      ok: false,
      reason: 'private-host',
    });
  });

  it('stops a redirect loop at the hop cap', async () => {
    expect(await validateMediaUrl(url('/redirect-loop'), 'image', stubResolve)).toEqual({
      ok: false,
      reason: 'too-many-redirects',
    });
  });

  it('accepts a framable HTML page for an iframe tile', async () => {
    expect(await validateMediaUrl(url('/page.html'), 'iframe', stubResolve)).toEqual({
      ok: true,
      contentType: 'text/html',
    });
  });

  it('rejects an iframe page that denies framing via X-Frame-Options', async () => {
    expect(await validateMediaUrl(url('/frame-denied'), 'iframe', stubResolve)).toEqual({
      ok: false,
      reason: 'x-frame-options',
    });
  });

  it('rejects a non-http(s) scheme without probing', async () => {
    expect(await validateMediaUrl('ftp://example.com/x.png', 'image')).toEqual({
      ok: false,
      reason: 'unsupported-scheme',
    });
  });
});
