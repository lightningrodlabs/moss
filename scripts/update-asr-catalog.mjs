#!/usr/bin/env node
// Regenerates src/main/asr/modelCatalogData.ts from the HuggingFace LFS
// pointers of the models listed in scripts/asr-catalog-lib.mjs, so the
// checksums Moss verifies downloads against track upstream republishes.
//
//   node scripts/update-asr-catalog.mjs          rewrite the data module
//   node scripts/update-asr-catalog.mjs --check  exit 1 if it would change
//
// The release setup runs --check so a stale catalog fails the release
// instead of shipping checksums that no longer match what users download.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASR_CATALOG_MODELS,
  parseLfsPointer,
  pointerUrl,
  renderCatalogData,
} from './asr-catalog-lib.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(REPO_ROOT, 'src', 'main', 'asr', 'modelCatalogData.ts');

const check = process.argv.includes('--check');

const rows = [];
for (const model of ASR_CATALOG_MODELS) {
  const url = pointerUrl(model.id);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const { sha256, sizeBytes } = parseLfsPointer(await res.text());
  rows.push({ ...model, sha256, sizeBytes });
  console.log(
    `  ${model.id.padEnd(15)} ${sha256.slice(0, 12)}…  ${sizeBytes.toLocaleString()} bytes`,
  );
}

const next = renderCatalogData(rows);
let current = '';
try {
  current = readFileSync(DATA_FILE, 'utf-8');
} catch {
  // A missing file is just "needs generating".
}

if (next === current) {
  console.log(`✓ ${DATA_FILE} is up to date`);
  process.exit(0);
}
if (check) {
  console.error(
    `✗ ${DATA_FILE} is out of date with HuggingFace. Run \`yarn update:asr-catalog\` and commit the result.`,
  );
  process.exit(1);
}
writeFileSync(DATA_FILE, next, 'utf-8');
console.log(`✓ wrote ${DATA_FILE}`);
