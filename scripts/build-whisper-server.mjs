#!/usr/bin/env node
// Builds whisper-server from the upstream whisper.cpp repo at a pinned
// tag, drops the binary into resources/bins/whisper-server-v<version><exe>.
//
// Why inline-build rather than fetch prebuilt:
//   Upstream whisper.cpp does not publish official prebuilt release
//   artifacts. Building on each CI runner is cheapest for now; revisit
//   with a separate binaries repo if build time becomes a bottleneck.
//
// Runtime requirements on the build host: git, cmake, a C++17 toolchain.
// Release CI runners already have all three.
//
// Skipped when the target binary is already present (idempotent for
// local dev — delete the file to force a rebuild).

import { execSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const mossConfig = JSON.parse(readFileSync(join(REPO_ROOT, 'moss.config.json'), 'utf-8'));
const WHISPER_VERSION = mossConfig.whisperServer;
if (!WHISPER_VERSION) {
  throw new Error('moss.config.json is missing "whisperServer" version');
}

const EXE = process.platform === 'win32' ? '.exe' : '';
const BIN_NAME = `whisper-server-v${WHISPER_VERSION}${EXE}`;
const BIN_DIR = join(REPO_ROOT, 'resources', 'bins');
const TARGET_PATH = join(BIN_DIR, BIN_NAME);

if (existsSync(TARGET_PATH)) {
  console.log(`✓ already present: ${TARGET_PATH}`);
  process.exit(0);
}

mkdirSync(BIN_DIR, { recursive: true });

const BUILD_ROOT = join(REPO_ROOT, 'target', 'whisper-cpp');
const SRC_DIR = join(BUILD_ROOT, `whisper-cpp-v${WHISPER_VERSION}`);
const BUILD_DIR = join(SRC_DIR, 'build');

// Fresh clone on every run — avoids partial-state issues when toggling
// between versions. The source dir is small (~10 MB).
if (existsSync(SRC_DIR)) {
  rmSync(SRC_DIR, { recursive: true, force: true });
}
mkdirSync(BUILD_ROOT, { recursive: true });

console.log(`↓ cloning whisper.cpp@v${WHISPER_VERSION}`);
run(
  `git clone --depth 1 --branch v${WHISPER_VERSION} https://github.com/ggerganov/whisper.cpp ${quote(SRC_DIR)}`,
  REPO_ROOT,
);

// Build flags chosen for portability across test-user machines rather
// than peak perf:
//   - GGML_NATIVE=OFF: no -march=native; avoid binaries that SIGILL on
//     older CPUs than the CI runner.
//   - GGML_METAL=OFF on macOS: no ggml-metal.metal shader bundling; CPU
//     base.en is fast enough for v1 (see spikes/asr-m0/RESULTS.md).
//   - BUILD_SHARED_LIBS=OFF: one self-contained binary, no .so/.dylib
//     sitting next to it needing resolver fiddling.
const CONFIGURE_FLAGS = [
  '-DCMAKE_BUILD_TYPE=Release',
  '-DWHISPER_BUILD_EXAMPLES=ON',
  '-DWHISPER_BUILD_TESTS=OFF',
  '-DBUILD_SHARED_LIBS=OFF',
  '-DGGML_NATIVE=OFF',
  '-DGGML_METAL=OFF',
  '-DGGML_METAL_EMBED_LIBRARY=OFF',
];

console.log(`⚙ configuring`);
run(`cmake -B ${quote(BUILD_DIR)} ${CONFIGURE_FLAGS.join(' ')} ${quote(SRC_DIR)}`, SRC_DIR);

console.log(`⚙ building whisper-server`);
run(
  `cmake --build ${quote(BUILD_DIR)} --config Release --target whisper-server --parallel`,
  SRC_DIR,
);

// CMake drops the binary in one of two places depending on generator:
//   - single-config (Unix Makefiles / Ninja): build/bin/whisper-server
//   - multi-config (MSBuild): build/bin/Release/whisper-server.exe
const candidates = [
  join(BUILD_DIR, 'bin', `whisper-server${EXE}`),
  join(BUILD_DIR, 'bin', 'Release', `whisper-server${EXE}`),
];
const builtBinary = candidates.find((p) => existsSync(p));
if (!builtBinary) {
  throw new Error(`built whisper-server binary not found; looked in:\n  ${candidates.join('\n  ')}`);
}

cpSync(builtBinary, TARGET_PATH);
if (process.platform !== 'win32') {
  chmodSync(TARGET_PATH, 0o755);
}

console.log(`✓ installed: ${TARGET_PATH}`);

function run(cmd, cwd) {
  execSync(cmd, { stdio: 'inherit', cwd });
}

function quote(p) {
  // cmake + git paths containing spaces are rare on CI runners; quote
  // defensively so local checkouts under `~/my stuff/` still work.
  return `"${p}"`;
}
