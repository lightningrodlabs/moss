import { describe, it, expect } from 'vitest';
import { localizedText } from './localized-text.js';

describe('localizedText', () => {
  it('uses a plain string unchanged whatever the locale', () => {
    expect(localizedText('Stewarded', 'de')).toBe('Stewarded');
  });

  it('picks the exact locale when present', () => {
    expect(localizedText({ en: 'Stewarded', de: 'Verwaltet' }, 'de')).toBe('Verwaltet');
  });

  it('matches locale keys case-insensitively', () => {
    expect(localizedText({ EN: 'Stewarded', 'pt-BR': 'Gerido' }, 'pt-br')).toBe('Gerido');
  });

  it('falls back from a regional locale to its language', () => {
    expect(localizedText({ en: 'Stewarded', pt: 'Gerido' }, 'pt-BR')).toBe('Gerido');
  });

  it('falls back to English when the locale is missing', () => {
    expect(localizedText({ en: 'Stewarded', de: 'Verwaltet' }, 'ja')).toBe('Stewarded');
  });

  it('falls back to the first entry when there is no English either', () => {
    expect(localizedText({ de: 'Verwaltet', fr: 'Géré' }, 'ja')).toBe('Verwaltet');
  });

  it('returns an empty string for an empty map or undefined', () => {
    expect(localizedText({}, 'en')).toBe('');
    expect(localizedText(undefined, 'en')).toBe('');
  });
});
