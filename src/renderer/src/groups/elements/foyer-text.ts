// Turns a foyer message's plain text into the HTML shown in the stream:
// escaped, with links made clickable and line breaks kept.

export function foyerMessageHtml(text: string): string {
  let cleaned = text.replace(/&/g, '&amp;');
  cleaned = cleaned.replace(/</g, '&lt;');
  cleaned = cleaned.replace(/>/g, '&gt;');
  cleaned = cleaned.replace(/https:\/\/theweave\.social\/wal\?weave/g, 'weave');
  const linked = cleaned.replace(
    /([a-z0-9-.]+:\/\/[^\s]+)/g,
    '<a style="text-decoration: underline;" href="$1">$1</a>',
  );
  return linked.replace(/\r?\n/g, '<br>');
}
