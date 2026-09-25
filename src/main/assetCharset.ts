/**
 * Tool UIs are served from disk through Electron's `net.fetch(file://…)`, which
 * labels files by extension only (`text/javascript`, `text/html`) and never adds a
 * charset. A UI whose index.html lacks `<meta charset>` is then decoded by Chromium
 * with the locale default (windows-1252 on most systems), and every classic script
 * it loads inherits that encoding. Modern libsodium builds embed their WASM as a raw
 * UTF-8 string literal, so a mis-decoded bundle fails at `WebAssembly.instantiate`.
 * Declaring UTF-8 at the transport level removes that dependency on the tool author.
 *
 * This is a policy choice: the header wins over in-document declarations (meta charset,
 * @charset, script charset attributes), so tools cannot opt into a non-UTF-8 encoding.
 * Every mainstream bundler and the Vite dev path already emit UTF-8, so nothing loses.
 */

const UTF8_CHARSET = 'charset=utf-8';

/** Content types whose bytes Chromium decodes as text and therefore need a charset. */
const TEXT_CONTENT_TYPE =
  /^(text\/|application\/(javascript|ecmascript|json|xml|xhtml\+xml)(;|$))/i;

/**
 * Return `contentType` with `charset=utf-8` appended when it names a text-based
 * type and carries no charset of its own. Any explicit charset, and any non-text
 * type, is passed through unchanged.
 */
export function withUtf8Charset(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const trimmed = contentType.trim();
  if (!TEXT_CONTENT_TYPE.test(trimmed)) return trimmed;
  if (/;\s*charset=/i.test(trimmed)) return trimmed;
  return `${trimmed}; ${UTF8_CHARSET}`;
}

/**
 * Copy `response` so its `Content-Type` declares UTF-8 for text-based assets.
 * The body stream is handed over untouched; only the header changes.
 */
export function withUtf8ContentType(response: Response): Response {
  const contentType = withUtf8Charset(response.headers.get('content-type'));
  if (!contentType || contentType === response.headers.get('content-type')) return response;
  const headers = new Headers(response.headers);
  headers.set('content-type', contentType);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
