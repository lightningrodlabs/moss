// src/main/asr/modelCatalog.ts
// The whisper models Moss can download, as published by whisper.cpp on
// HuggingFace. Checked in rather than fetched so an install can show the
// list offline and verify every download against a known checksum. The
// sha256 and size come from the LFS pointer at
// https://huggingface.co/ggerganov/whisper.cpp/raw/main/<filename>.

import path from 'node:path';

import type { AsrLatencyTier } from '@theweave/moss-types';

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

function entry(
  id: string,
  sha256: string,
  sizeBytes: number,
  latencyTier: AsrLatencyTier,
): AsrModelCatalogEntry {
  const filename = `ggml-${id}.bin`;
  return {
    id,
    filename,
    url: HF_BASE + filename,
    sha256,
    sizeBytes,
    languages: id.endsWith('.en') ? ['en'] : WHISPER_MULTILINGUAL_CODES,
    latencyTier,
    startTimeoutMs: startTimeoutForSize(sizeBytes),
  };
}

export const ASR_MODEL_CATALOG: readonly AsrModelCatalogEntry[] = Object.freeze([
  entry('tiny', 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21', 77_691_713, 'fast'),
  entry('tiny.en', '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f', 77_704_715, 'fast'),
  entry('base', '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', 147_951_465, 'ok'),
  entry('base.en', 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', 147_964_211, 'ok'),
  entry('small', '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', 487_601_967, 'ok'),
  entry('small.en', 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d', 487_614_201, 'ok'),
  entry('medium', '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208', 1_533_763_059, 'slow'),
  entry('medium.en', 'cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356', 1_533_774_781, 'slow'),
  entry('large-v3-turbo', '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69', 1_624_555_275, 'slow'),
  entry('large-v3', '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2', 3_095_033_483, 'slow'),
]);

export function catalogEntryById(id: string): AsrModelCatalogEntry | undefined {
  return ASR_MODEL_CATALOG.find((e) => e.id === id);
}

/** Match a model file by its base name, so overrides pointing at a catalog file still get catalog metadata. */
export function catalogEntryForPath(p: string): AsrModelCatalogEntry | undefined {
  const base = path.basename(p);
  return ASR_MODEL_CATALOG.find((e) => e.filename === base);
}
