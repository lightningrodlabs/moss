import { configureLocalization } from '@lit/localize';

// Supported locales - must match lit-localize.json targetLocales
export const sourceLocale = 'en';
export const targetLocales = ['de', 'fr', 'es', 'tr', 'it', 'pt'] as const;
export const allLocales = [sourceLocale, ...targetLocales] as const;

export type SupportedLocale = (typeof allLocales)[number];

// Configure @lit/localize for runtime mode
const localization = configureLocalization({
  sourceLocale,
  targetLocales,
  loadLocale: async (locale: string) => {
    try {
      switch (locale) {
        case 'de':
          return import('./generated/de.js');
        case 'fr':
          return import('./generated/fr.js');
        case 'es':
          return import('./generated/es.js');
        case 'tr':
          return import('./generated/tr.js');
        case 'it':
          return import('./generated/it.js');
        case 'pt':
          return import('./generated/pt.js');
        default:
          // Source locale (en) doesn't need to load anything
          return { templates: {} };
      }
    } catch (e) {
      // If translation file can't be loaded, return empty templates
      console.warn(`Failed to load locale '${locale}':`, e);
      return { templates: {} };
    }
  },
});

export const getLocale = localization.getLocale;
export const setLocale = localization.setLocale;

/**
 * Check if a locale string is one of our supported locales
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (allLocales as readonly string[]).includes(locale);
}

/**
 * Get the browser's preferred locale, falling back to 'en' if not supported
 */
export function getBrowserLocale(): SupportedLocale {
  // navigator.language returns e.g. "en-US", "de-DE", "fr"
  const browserLang = navigator.language.split('-')[0];
  return isSupportedLocale(browserLang) ? browserLang : 'en';
}

/**
 * Language display names for UI
 */
export const LANGUAGE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  tr: 'Türkçe',
  it: 'Italiano',
  pt: 'Português',
};
