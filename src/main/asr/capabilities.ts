// Derive a LocalModelCapabilities value from the broker's configured
// model and environment. Pure function so the wire-up can call it once
// at init and cache the result; trivially unit-testable.
//
// Language and latency come from the model catalog when the file is a
// catalog model. Files outside the catalog fall back to whisper.cpp's
// ggml naming convention:
//   - ggml-<size>.<lang>.bin  → single-language model (e.g. base.en)
//   - ggml-<size>.bin         → multilingual model (all 99 codes)

import path from 'node:path';

import type { LocalModelCapabilities } from '@theweave/api';

import { WHISPER_MULTILINGUAL_CODES, catalogEntryForPath } from './modelCatalog';

export { WHISPER_MULTILINGUAL_CODES };

export interface ComputeAsrCapabilitiesInput {
  /** Absolute path to the loaded ggml model file, or null if unconfigured. */
  modelPath: string | null;
  /** Override for the `latencyTier` field. Defaults to 'ok'. */
  latencyTier?: 'fast' | 'ok' | 'slow';
}

export function computeAsrCapabilities(input: ComputeAsrCapabilitiesInput): LocalModelCapabilities {
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
  const entry = catalogEntryForPath(input.modelPath);
  const { model, languages } = entry
    ? { model: entry.id, languages: [...entry.languages] }
    : parseModelFilename(input.modelPath);
  return {
    asr: {
      available: true,
      languages,
      streaming: false,
      model,
      latencyTier: input.latencyTier ?? entry?.latencyTier ?? 'ok',
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

