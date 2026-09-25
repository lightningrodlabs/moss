import { describe, expect, it } from 'vitest';

import { whisperConfigureFlags } from './whisper-build-flags.mjs';

const X86_64_V3 = [
  '-DGGML_AVX=ON',
  '-DGGML_AVX2=ON',
  '-DGGML_FMA=ON',
  '-DGGML_F16C=ON',
  '-DGGML_BMI2=ON',
];

describe('whisperConfigureFlags', () => {
  it('turns on the x86-64-v3 instruction sets for x64 builds', () => {
    for (const platform of ['linux', 'win32', 'darwin'] as const) {
      const flags = whisperConfigureFlags(platform, 'x64');
      for (const f of X86_64_V3) expect(flags).toContain(f);
      expect(flags).toContain('-DGGML_NATIVE=OFF');
    }
  });

  it('adds no x86 instruction flags for arm64 builds', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const flags = whisperConfigureFlags(platform, 'arm64');
      for (const f of X86_64_V3) expect(flags).not.toContain(f);
    }
  });

  it('enables Metal only on macOS', () => {
    expect(whisperConfigureFlags('darwin', 'arm64')).toContain('-DGGML_METAL=ON');
    expect(whisperConfigureFlags('linux', 'x64')).toContain('-DGGML_METAL=OFF');
  });

  it('builds one static release binary', () => {
    const flags = whisperConfigureFlags('linux', 'x64');
    expect(flags).toContain('-DCMAKE_BUILD_TYPE=Release');
    expect(flags).toContain('-DBUILD_SHARED_LIBS=OFF');
  });
});
