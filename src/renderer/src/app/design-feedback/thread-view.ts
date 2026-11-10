import type { FeedbackActionResult, FeedbackRecordSummary } from '../../electron-api';

/** Which user-facing notice a reply or resolve outcome should produce. */
export type ActionNotice = 'success' | 'already-closed' | 'rejected' | 'unreachable';

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(([^)]*)\)/g;

/**
 * Rewrites markdown images as plain links so a thread never loads remote
 * images; the reader opens them deliberately.
 */
export function imagesToLinks(markdown: string): string {
  return markdown.replace(
    IMAGE_MARKDOWN,
    (_m, alt: string, url: string) => `[${alt === '' ? 'image' : alt}](${url})`,
  );
}

/** Splits records into the Open and Closed tabs, newest first. Unfiled records count as open. */
export function splitByState(records: FeedbackRecordSummary[]): {
  open: FeedbackRecordSummary[];
  closed: FeedbackRecordSummary[];
} {
  const sorted = [...records].sort((a, b) => b.timestamp - a.timestamp);
  return {
    open: sorted.filter((r) => r.state !== 'closed'),
    closed: sorted.filter((r) => r.state === 'closed'),
  };
}

const TITLE_FALLBACK_LENGTH = 60;

/** The issue title when the record has one, otherwise the start of the reported text. */
export function cardTitle(record: FeedbackRecordSummary): string {
  return record.title ?? record.text.slice(0, TITLE_FALLBACK_LENGTH);
}

/**
 * Picks the notice for a reply or resolve outcome. Only a closed issue and a
 * rejected reply get their own notice; every other failure reads as "could not reach".
 */
export function actionNotice(result: FeedbackActionResult): ActionNotice {
  if (result.ok) return 'success';
  switch (result.reason) {
    case 'conflict':
      return 'already-closed';
    case 'rejected':
      return 'rejected';
    default:
      return 'unreachable';
  }
}

/** Unread badge text, capped so it fits the dot. */
export function badgeText(count: number): string {
  return count > 9 ? '9+' : String(count);
}
