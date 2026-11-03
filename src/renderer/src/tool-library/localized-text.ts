import type { LocalizedText } from '@theweave/api';

/**
 * Resolves a Tool-supplied label or description for the locale Moss is
 * showing. A plain string is used as is. A map is tried by exact locale,
 * then by language alone (`pt` for `pt-BR`), then English, then whatever
 * the Tool listed first, so a Tool that translated some languages still
 * reads in every locale.
 */
export function localizedText(text: LocalizedText | undefined, locale: string): string {
  if (text === undefined) return '';
  if (typeof text === 'string') return text;
  const byLocale = new Map(Object.entries(text).map(([k, v]) => [k.toLowerCase(), v]));
  const wanted = locale.toLowerCase();
  const language = wanted.split('-')[0];
  return (
    byLocale.get(wanted) ??
    byLocale.get(language) ??
    byLocale.get('en') ??
    byLocale.values().next().value ??
    ''
  );
}
