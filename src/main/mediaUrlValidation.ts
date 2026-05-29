import { isIP } from 'node:net';
import dns from 'node:dns/promises';

/**
 * Pure validation helpers backing the `validate-media-url` IPC handler. Kept
 * free of any electron import so they can be unit-tested in a plain node env.
 */

/** True for an inline `data:image/...` URL — inert, needs no network probe. */
export function isDataImageUrl(rawUrl: string): boolean {
  return /^data:image\//i.test(rawUrl.trim());
}

/**
 * SSRF guard: classify a literal IP address as private/loopback/link-local so
 * we never probe the host's internal network on behalf of a (possibly
 * malicious) steward-supplied URL. A non-IP string returns `true` (unsafe) so
 * callers must resolve hostnames via DNS first.
 */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const o = ip.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true; // malformed → treat as unsafe
    if (o[0] === 10) return true; // 10.0.0.0/8
    if (o[0] === 127) return true; // 127.0.0.0/8 loopback
    if (o[0] === 0) return true; // 0.0.0.0/8
    if (o[0] === 169 && o[1] === 254) return true; // 169.254.0.0/16 link-local
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16.0.0/12
    if (o[0] === 192 && o[1] === 168) return true; // 192.168.0.0/16
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // 100.64.0.0/10 CGNAT
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 unique-local
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4 address.
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  // Not a literal IP — caller resolves via DNS first.
  return true;
}

/**
 * Reject a host that points at this machine or a private network. Literal IPs
 * are classified directly; hostnames are resolved and every returned address
 * is checked, so a public name that resolves to a loopback/RFC1918 address
 * (DNS-rebinding style) is still refused. Throws `Error('private-host')` when
 * the host is not safe to probe.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('private-host');
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('private-host');
    return;
  }
  const records = await dns.lookup(host, { all: true });
  if (records.length === 0 || records.some((r) => isPrivateIp(r.address))) {
    throw new Error('private-host');
  }
}

/**
 * Conservative best-effort read of a CSP `frame-ancestors` directive: returns
 * true when the directive would prevent our renderer from framing the page.
 * Refuses `'none'` and any specific allowlist (no `*`), since our renderer
 * origin won't be on such a list and the browser would block the frame anyway.
 * A page that slips through still surfaces inline as an empty iframe.
 */
export function frameAncestorsBlocks(cspHeader: string | null | undefined): boolean {
  const csp = (cspHeader ?? '').toLowerCase();
  const fa = csp.match(/frame-ancestors([^;]*)/)?.[1]?.trim();
  if (fa === undefined) return false; // directive absent
  if (fa === '') return false; // present but empty — treat as permissive
  return !fa.includes('*');
}
