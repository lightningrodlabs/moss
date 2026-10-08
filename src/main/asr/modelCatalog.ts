// The whisper models Moss can download, as published by whisper.cpp on
// HuggingFace. Checked in rather than fetched so an install can show the
// list offline and verify every download against a known checksum. The
// ids, checksums and sizes live in the generated modelCatalogData.ts;
// `yarn update:asr-catalog` refreshes them from the HuggingFace LFS
// pointers, and the release setup fails if they have drifted.

import path from 'node:path';

import type { AsrLatencyTier } from '@theweave/moss-types';

import { ASR_MODEL_CATALOG_DATA, type AsrModelCatalogRow } from './modelCatalogData';

export interface AsrModelCatalogEntry {
  /** Short name as whisper.cpp uses it, e.g. 'base.en'. */
  id: string;
  /** File name on disk and on HuggingFace, e.g. 'ggml-base.en.bin'. */
  filename: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  /** ISO 639-1 codes the model transcribes. */
  languages: readonly string[];
  latencyTier: AsrLatencyTier;
  /** Readiness budget for whisper-server loading this model on a cold cache. */
  startTimeoutMs: number;
}

/**
 * The language codes whisper's multilingual models expose, per
 * whisper.cpp's `whisper_lang_str` table. Static — this is a property
 * of the model family, not of any particular ggml file.
 */
export const WHISPER_MULTILINGUAL_CODES: readonly string[] = Object.freeze([
  'en',
  'zh',
  'de',
  'es',
  'ru',
  'ko',
  'fr',
  'ja',
  'pt',
  'tr',
  'pl',
  'ca',
  'nl',
  'ar',
  'sv',
  'it',
  'id',
  'hi',
  'fi',
  'vi',
  'he',
  'uk',
  'el',
  'ms',
  'cs',
  'ro',
  'da',
  'hu',
  'ta',
  'no',
  'th',
  'ur',
  'hr',
  'bg',
  'lt',
  'la',
  'mi',
  'ml',
  'cy',
  'sk',
  'te',
  'fa',
  'lv',
  'bn',
  'sr',
  'az',
  'sl',
  'kn',
  'et',
  'mk',
  'br',
  'eu',
  'is',
  'hy',
  'ne',
  'mn',
  'bs',
  'kk',
  'sq',
  'sw',
  'gl',
  'mr',
  'pa',
  'si',
  'km',
  'sn',
  'yo',
  'so',
  'af',
  'oc',
  'ka',
  'be',
  'tg',
  'sd',
  'gu',
  'am',
  'yi',
  'lo',
  'uz',
  'fo',
  'ht',
  'ps',
  'tk',
  'nn',
  'mt',
  'sa',
  'lb',
  'my',
  'bo',
  'tl',
  'mg',
  'as',
  'tt',
  'haw',
  'ln',
  'ha',
  'ba',
  'jw',
  'su',
]);

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

/** One minute to come up, plus a minute per gigabyte to page the weights in. */
function startTimeoutForSize(sizeBytes: number): number {
  return 60_000 + Math.ceil(sizeBytes / 1_000_000_000) * 60_000;
}

function entry(row: AsrModelCatalogRow): AsrModelCatalogEntry {
  const filename = `ggml-${row.id}.bin`;
  return {
    id: row.id,
    filename,
    url: HF_BASE + filename,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    languages: row.id.endsWith('.en') ? ['en'] : WHISPER_MULTILINGUAL_CODES,
    latencyTier: row.latencyTier,
    startTimeoutMs: startTimeoutForSize(row.sizeBytes),
  };
}

export const ASR_MODEL_CATALOG: readonly AsrModelCatalogEntry[] = Object.freeze(
  ASR_MODEL_CATALOG_DATA.map(entry),
);

export function catalogEntryById(id: string): AsrModelCatalogEntry | undefined {
  return ASR_MODEL_CATALOG.find((e) => e.id === id);
}

/** Match a model file by its base name, so overrides pointing at a catalog file still get catalog metadata. */
export function catalogEntryForPath(p: string): AsrModelCatalogEntry | undefined {
  const base = path.basename(p);
  return ASR_MODEL_CATALOG.find((e) => e.filename === base);
}
