import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import {
  frameAncestorsBlocks,
  imageContentAccepted,
  isDataImageUrl,
  resolvePublicIp,
} from './mediaUrlValidation';

/**
 * Network probe backing the `validate-media-url` IPC handler. Kept free of any
 * electron import so it can be exercised end-to-end against a local HTTP server
 * in unit tests — the SSRF guard and redirect handling are only meaningful when
 * a real request is actually issued.
 */

export type MediaUrlResult = { ok: true; contentType: string } | { ok: false; reason: string };

/** Upper bound on redirect hops the probe will re-validate and follow. */
const MAX_MEDIA_URL_REDIRECTS = 5;

/** How long the whole probe (across every redirect hop) may take. */
const MEDIA_URL_TIMEOUT_MS = 5000;

type MediaProbeResult =
  | { type: 'response'; status: number; headers: http.IncomingHttpHeaders }
  | { type: 'error'; message: string };

/**
 * Issue a single GET to `url`, pinning the connection to `pinned` — the exact IP
 * the caller validated as public. The hostname is still used for the TLS SNI,
 * certificate verification, and Host header, so only the resolved address is
 * forced; this closes the DNS-rebind window where the network stack would
 * otherwise resolve the name a second time and could land on an internal IP.
 * Redirects are not followed (node http/https surfaces the 3xx so the caller can
 * re-validate the next hop). The body is never read — the socket is destroyed as
 * soon as the headers arrive.
 */
function probeMediaUrlOnce(
  url: URL,
  pinned: { address: string; family: number },
  signal: AbortSignal,
): Promise<MediaProbeResult> {
  return new Promise((resolve) => {
    // node's autoSelectFamily (default on) calls lookup with `all: true` and
    // expects an array; the legacy single-result form is still used otherwise.
    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: pinned.address, family: pinned.family }]);
      } else {
        callback(null, pinned.address, pinned.family);
      }
    };
    const lib = url.protocol === 'https:' ? https : http;
    const request = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        signal,
        lookup,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const { headers } = response;
        response.destroy();
        resolve({ type: 'response', status, headers });
      },
    );
    request.on('error', (error: Error) => resolve({ type: 'error', message: error.message }));
    request.end();
  });
}

/** Read a single response header, lowercased, joining any duplicate values. */
function mediaHeader(headers: http.IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  if (value === undefined) return '';
  return (Array.isArray(value) ? value.join(', ') : value).toLowerCase();
}

/**
 * Probe `rawUrl` to decide whether the renderer can show it as an image or frame
 * it in an iframe. Returns `{ ok: false, reason }` on any failure (bad URL,
 * non-http(s), private/loopback host, network error/timeout, HTTP error,
 * missing/unexpected content-type, blocked X-Frame-Options or CSP
 * frame-ancestors for iframe kind).
 *
 * This is an advisory UX check only, not an enforcement boundary: a URL that
 * validates here can serve different content (or become unreachable) later, and
 * the persisted value is rendered as-is on every load. Its only job is to give
 * the steward immediate feedback when a URL obviously won't embed.
 */
export async function validateMediaUrl(
  rawUrl: string,
  kind: 'image' | 'iframe',
  resolveHost: (hostname: string) => Promise<{ address: string; family: number }> = resolvePublicIp,
): Promise<MediaUrlResult> {
  // Inline data: images are inert and need no network probe; allow them for
  // image tiles (they are sanitized at render). Never for iframes.
  if (kind === 'image' && isDataImageUrl(rawUrl)) {
    return { ok: true, contentType: 'image/*' };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported-scheme' };
  }

  // Bound the whole probe — across every redirect hop — so a slow/hung host or a
  // long redirect chain can't pin a main-process socket open indefinitely.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_URL_TIMEOUT_MS);
  try {
    // Follow redirects one hop at a time, re-resolving and re-validating the
    // host on every hop and pinning the connection to the checked IP. A public
    // URL must not be able to 30x-redirect the probe onto the host's own/internal
    // network (loopback, link-local, cloud-metadata, RFC1918), nor rebind a
    // public name to an internal address between the check and the connect.
    let current = parsed;
    for (let hop = 0; ; hop++) {
      if (hop > MAX_MEDIA_URL_REDIRECTS) {
        return { ok: false, reason: 'too-many-redirects' };
      }
      let pinned: { address: string; family: number };
      try {
        pinned = await resolveHost(current.hostname);
      } catch {
        return { ok: false, reason: 'private-host' };
      }
      const result = await probeMediaUrlOnce(current, pinned, controller.signal);
      if (result.type === 'error') {
        if (controller.signal.aborted) return { ok: false, reason: 'timeout' };
        return { ok: false, reason: `fetch-failed: ${result.message}` };
      }
      if (result.status >= 300 && result.status < 400) {
        const location = result.headers.location;
        if (!location) return { ok: false, reason: `http-${result.status}` };
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return { ok: false, reason: 'invalid-redirect' };
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          return { ok: false, reason: 'unsupported-scheme' };
        }
        current = next;
        continue;
      }
      if (result.status < 200 || result.status >= 300) {
        return { ok: false, reason: `http-${result.status}` };
      }
      const ct = mediaHeader(result.headers, 'content-type');
      if (kind === 'image') {
        // Match the image-extension heuristic against the URL the steward
        // entered: redirect-backed download endpoints (e.g. GitHub release
        // assets) carry the `.png` in the original path, not the signed target
        // they redirect to.
        if (!imageContentAccepted(ct, parsed.pathname)) {
          return { ok: false, reason: 'not-an-image' };
        }
      } else {
        if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
          return { ok: false, reason: 'not-html' };
        }
        const xfo = mediaHeader(result.headers, 'x-frame-options');
        if (xfo === 'deny' || xfo === 'sameorigin') {
          return { ok: false, reason: 'x-frame-options' };
        }
        // CSP frame-ancestors supersedes X-Frame-Options on modern sites.
        if (frameAncestorsBlocks(mediaHeader(result.headers, 'content-security-policy'))) {
          return { ok: false, reason: 'frame-ancestors' };
        }
      }
      return { ok: true, contentType: ct };
    }
  } finally {
    clearTimeout(timeout);
  }
}
