#!/usr/bin/env node
// Apply wasm-opt -Oz to every zome wasm produced by the workspace build.
// Used by main-0.7 (and later) where there is no per-cell DnaHash compatibility
// burden, so optimising integrity wasms is free. Expect ~30-40% size reduction
// on each wasm; the on-disk wasm-cache and compiled-module memory both shrink
// roughly proportionally.

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';

const dir = resolve('target/wasm32-unknown-unknown/release');
const wasms = readdirSync(dir)
  .filter((f) => f.endsWith('.wasm'))
  .filter((f) => !f.startsWith('.'))
  .sort();

if (wasms.length === 0) {
  console.error(`No .wasm files found in ${dir}`);
  process.exit(1);
}

let totalBefore = 0;
let totalAfter = 0;

for (const name of wasms) {
  const src = join(dir, name);
  const tmp = `${src}.opt`;
  const before = statSync(src).size;
  execFileSync(
    'wasm-opt',
    ['-Oz', '--strip-debug', '--strip-producers', src, '-o', tmp],
    { stdio: 'inherit' },
  );
  const after = statSync(tmp).size;
  renameSync(tmp, src);
  totalBefore += before;
  totalAfter += after;
  const pct = (((before - after) / before) * 100).toFixed(1);
  console.log(`  ${name.padEnd(32)} ${String(before).padStart(8)} -> ${String(after).padStart(8)}  (-${pct}%)`);
}

const totalPct = (((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1);
console.log(`\n  total: ${totalBefore} -> ${totalAfter}  (-${totalPct}%)`);
