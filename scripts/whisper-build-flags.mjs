// CMake configure flags for the bundled whisper-server, per build target.
//
// Choices:
//   - GGML_NATIVE=OFF: no -march=native, so the binary does not depend on
//     the CI runner's exact CPU.
//   - x64 targets the x86-64-v3 level explicitly (AVX, AVX2, FMA, F16C,
//     BMI2). With native off, ggml leaves these off unless named, and the
//     model then runs on scalar code, 10 to 30 times slower than realtime
//     needs. x86-64-v3 covers Intel from 2013 (Haswell) and AMD from 2015
//     (Excavator); older x64 CPUs fail with an illegal instruction.
//   - BUILD_SHARED_LIBS=OFF: one self-contained binary, no .so/.dylib
//     sitting next to it needing resolver fiddling.
//   - GGML_METAL=ON on macOS: Metal ships with every supported macOS
//     version, so enabling it is a free 3–8× speedup on Apple Silicon
//     with zero user-side dependency. GGML_METAL_EMBED_LIBRARY=ON
//     bakes the shader source into the binary so there's no separate
//     .metallib to ship alongside it.
//   - No CUDA/Vulkan on Linux/Windows: discrete-GPU gains are real but
//     require a runtime dep (CUDA toolkit) or SDK (Vulkan) that we
//     don't want to impose on users. Revisit when a concrete ask lands.

const X86_64_V3_FLAGS = [
  '-DGGML_AVX=ON',
  '-DGGML_AVX2=ON',
  '-DGGML_FMA=ON',
  '-DGGML_F16C=ON',
  '-DGGML_BMI2=ON',
];

/**
 * @param {NodeJS.Platform} platform
 * @param {string} arch  `process.arch` of the build host, which is the target arch on the release runners
 * @returns {string[]}
 */
export function whisperConfigureFlags(platform, arch) {
  const isDarwin = platform === 'darwin';
  return [
    '-DCMAKE_BUILD_TYPE=Release',
    '-DWHISPER_BUILD_EXAMPLES=ON',
    '-DWHISPER_BUILD_TESTS=OFF',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DGGML_NATIVE=OFF',
    ...(arch === 'x64' ? X86_64_V3_FLAGS : []),
    `-DGGML_METAL=${isDarwin ? 'ON' : 'OFF'}`,
    `-DGGML_METAL_EMBED_LIBRARY=${isDarwin ? 'ON' : 'OFF'}`,
  ];
}
