import type { Config } from 'dompurify';

/**
 * DOMPurify allow-list for feedback threads, where anyone who can comment on
 * the issue controls the content. Threads must never fetch remote resources,
 * since a fetch would reveal the reporter's IP address and online times to the
 * comment author. Only paragraphs, line breaks, links, inline and block code,
 * emphasis, quotes and lists survive, and the only attribute is a link's href.
 * Images reach the thread as links (see imagesToLinks).
 */
export const THREAD_MARKDOWN_SANITIZE = {
  ALLOWED_TAGS: ['p', 'br', 'a', 'code', 'pre', 'em', 'strong', 'blockquote', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: ['href'],
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
} satisfies Config;
