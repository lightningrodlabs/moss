// Derive a LocalModelCapabilities value from the broker's configured
// model and environment. Pure function so the wire-up can call it once
// at init and cache the result; trivially unit-testable.
//
// Language inference follows whisper.cpp's ggml naming convention:
//   - ggml-<size>.<lang>.bin  → single-language model (e.g. base.en)
//   - ggml-<size>.bin         → multilingual model (all 99 codes)
//
// The multilingual list below is whisper's fixed set; change only when
// upstream whisper.cpp adds or drops a code.

import path from 'node:path';

import type { LocalModelCapabilities } from '@theweave/api';

export interface ComputeAsrCapabilitiesInput {
  /** Absolute path to the loaded ggml model file, or null if unconfigured. */
  modelPath: string | null;
  /** Override for the `latencyTier` field. Defaults to 'ok'. */
  latencyTier?: 'fast' | 'ok' | 'slow';
}

export function computeAsrCapabilities(
  input: ComputeAsrCapabilitiesInput,
): LocalModelCapabilities {
  if (!input.modelPath) {
    return {
      asr: {
        available: false,
        languages: [],
        streaming: false,
        model: '',
        latencyTier: input.latencyTier ?? 'ok',
      },
    };
  }
  const { model, languages } = parseModelFilename(input.modelPath);
  return {
    asr: {
      available: true,
      languages,
      streaming: false,
      model,
      latencyTier: input.latencyTier ?? 'ok',
    },
  };
}

function parseModelFilename(modelPath: string): { model: string; languages: string[] } {
  const file = path.basename(modelPath);
  // Strip a trailing .bin (case-insensitive) and a leading ggml- if present.
  let stem = file.replace(/\.bin$/i, '');
  if (stem.toLowerCase().startsWith('ggml-')) stem = stem.slice('ggml-'.length);

  // Split on '.'; a trailing 2-letter lang segment marks a monolingual
  // model (base.en, small.en, etc). Longer suffixes (q5_0, distil-*,
  // etc.) don't match, so they fall through to "multilingual".
  const parts = stem.split('.');
  const lastPart = parts[parts.length - 1];
  if (parts.length > 1 && /^[a-z]{2}$/.test(lastPart)) {
    return { model: stem, languages: [lastPart] };
  }
  return { model: stem, languages: [...WHISPER_MULTILINGUAL_CODES] };
}

/**
 * The language codes whisper's multilingual models expose, per
 * whisper.cpp's `whisper_lang_str` table. Static — this is a property
 * of the model family, not of any particular ggml file.
 */
export const WHISPER_MULTILINGUAL_CODES: readonly string[] = Object.freeze([
  'en', 'zh', 'de', 'es', 'ru', 'ko', 'fr', 'ja', 'pt', 'tr',
  'pl', 'ca', 'nl', 'ar', 'sv', 'it', 'id', 'hi', 'fi', 'vi',
  'he', 'uk', 'el', 'ms', 'cs', 'ro', 'da', 'hu', 'ta', 'no',
  'th', 'ur', 'hr', 'bg', 'lt', 'la', 'mi', 'ml', 'cy', 'sk',
  'te', 'fa', 'lv', 'bn', 'sr', 'az', 'sl', 'kn', 'et', 'mk',
  'br', 'eu', 'is', 'hy', 'ne', 'mn', 'bs', 'kk', 'sq', 'sw',
  'gl', 'mr', 'pa', 'si', 'km', 'sn', 'yo', 'so', 'af', 'oc',
  'ka', 'be', 'tg', 'sd', 'gu', 'am', 'yi', 'lo', 'uz', 'fo',
  'ht', 'ps', 'tk', 'nn', 'mt', 'sa', 'lb', 'my', 'bo', 'tl',
  'mg', 'as', 'tt', 'haw', 'ln', 'ha', 'ba', 'jw', 'su',
]);
