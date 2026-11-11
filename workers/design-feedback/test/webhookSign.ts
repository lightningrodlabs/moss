import { SELF, env } from 'cloudflare:test';

const enc = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The `X-Hub-Signature-256` value GitHub would send for `body` under `secret`. */
export async function hubSignature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return `sha256=${toHex(mac)}`;
}

/** Posts a webhook delivery through the worker, signed with the test secret unless overridden. */
export async function postWebhook(
  event: string,
  payload: unknown,
  opts: { signature?: string | null; secret?: string } = {},
): Promise<Response> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'X-GitHub-Event': event,
  };
  const signature =
    opts.signature === undefined
      ? await hubSignature(opts.secret ?? env.WEBHOOK_SECRET, body)
      : opts.signature;
  if (signature !== null) headers['X-Hub-Signature-256'] = signature;
  return SELF.fetch('https://w/v1/webhook', { method: 'POST', headers, body });
}
