# M0 results — 2026-04-17

## Verdict

Runtime works. Pivoted from N-API binding to sidecar after seeing
Presence's bench numbers and reproducing the gap. Move to M1.

## Bench data (Linux x64, workframe1, CPU only, 4–8 threads)

All numbers on the bundled JFK sample (11.0 s of clean speech).

| runtime                          | model    | threads | strategy | ms    | RTF   | × realtime |
| -------------------------------- | -------- | ------- | -------- | ----- | ----- | ---------- |
| whisper-cli (nixpkgs#whisper-cpp)| tiny.en  |       4 | greedy   | 484   | 0.044 | **23×**    |
| whisper-cli (nixpkgs#whisper-cpp)| base.en  |       4 | greedy   | 920   | 0.084 | **12×**    |
| whisper-server (sidecar over HTTP)| base.en |       4 | greedy   | 1559  | 0.142 | **7×**     |
| smart-whisper (npm prebuilt)     | tiny.en  |  default| beam     | 4098  | 0.373 | 2.7×       |
| smart-whisper (npm prebuilt)     | tiny.en  |       8 | greedy   | 2000  | 0.182 | 5.5×       |
| smart-whisper (npm prebuilt)     | base.en  |  default| beam     | 9314  | 0.847 | 1.2×       |
| smart-whisper (locally rebuilt)  | base.en  |       8 | greedy   | 4830  | 0.439 | 2.3×       |

Cross-checks:

- Presence's spike on the same workstation reported tiny.en at ~29× RT
  and base.en at ~16× RT (their 17 s sample, slightly more amortized
  model-load — consistent with our 23× / 12× on an 11 s sample).
- The 5–9× gap between smart-whisper and whisper-cli persists across
  thread counts and decode strategies. A clean local source rebuild
  closed only a small fraction of it. Cause unclear; not worth
  tracking down further if the sidecar path works.

## What was validated

- whisper-cli batch transcription on Linux x64 with both tiny.en and
  base.en. Output text correct in both cases, with punctuation on
  base.en.
- Sidecar architecture via `whisper-server`: spawn once (ready in
  ~450 ms with model loaded), POST WAV via multipart, parse JSON
  segments. Process isolation works as expected.
- The earlier smart-whisper batch and emulated-streaming harnesses
  also work, just slowly. They stay in the repo as an alternate
  reference and as a fallback if the sidecar binary path turns out to
  be too painful for some platform.

## Things that surprised us

1. **N-API binding is materially slower than the upstream CLI on the
   same library, same machine.** Even after a clean source rebuild.
   Did not expect this when picking the N-API path initially.
2. **Per-window inference cost dominates** when you naïvely chunk the
   stream. 11 s in batch on tiny.en took 0.5 s; 5 × 3 s windows took
   ~30 s aggregate. Encoder runs per-window. M1's broker has to
   decide whether to use VAD (recommended) or larger windows or just
   accept the latency cost.
3. **whisper.cpp has a bunch of useful sibling binaries** that ship
   with the same package: `whisper-vad-speech-segments` for VAD,
   `whisper-stream` for live mic, `whisper-bench`. M1 should
   investigate `whisper-vad-speech-segments` for the chunking
   problem before writing custom VAD.

## Things confirmed from the plan's risk list

- Streaming emulation over batch runtimes introduces real latency
  floors — ✓ confirmed empirically. Worth surfacing as
  `capabilities().asr.latencyTier`.
- Audio format normalization in JS is fine at this scale. The
  resampler in `lib/audio.mjs` works.
- Per-platform binary distribution is non-trivial — flagged for M1.

## What changes in the plan as a result

Already updated MOSS_LOCAL_MODELS_PLAN.md:

- M0 marked done; sidecar runtime recorded.
- M1 amended: chunk via VAD (try `whisper-vad-speech-segments` first),
  not fixed window. Run broker in `utilityProcess`. Prebuild
  whisper-cli/whisper-server per platform via Moss CI; ship via the
  existing `resources/bins` mechanism.
- `LocalModelCapabilities.asr` schema gained `latencyTier`.
- Default model bumped from tiny.en to base.en (Presence's
  recommendation, confirmed on our hardware).

## Spike artifacts in this directory

- `RUNTIME_CHOICE.md` — decision rationale (post-revision)
- `RESULTS.md` — this doc
- `package.json`, `lib/audio.mjs`
- `harness-batch.mjs`, `harness-stream.mjs` — N-API path (kept as
  alternate / fallback reference)
- `harness-sidecar.mjs` — whisper-server sidecar path (the one we're
  taking forward)
- `bench-tuned.mjs` — N-API perf sweep harness used to chase the gap
- `demo.mjs`, `fetch-model.mjs` — runner + model fetcher
- `models/`, `samples/` — fetched at setup, gitignored

## How to reproduce

```bash
cd spikes/asr-m0
yarn install            # smart-whisper still installed for the bench-tuned path
yarn fetch-model
node fetch-model.mjs    # also pulls base.en if you want it via the bench script
node harness-sidecar.mjs samples/jfk.wav         # sidecar (the chosen path)
node bench-tuned.mjs                              # N-API perf sweep (tiny.en + base.en)
```

The sidecar harness shells out to `nix shell nixpkgs#whisper-cpp -c
whisper-server …`, so it requires nix on PATH. M1 will replace the
`nix shell` wrapper with the binary fetched into `resources/bins`.
