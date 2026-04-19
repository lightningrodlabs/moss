# M0 — Runtime choice

## Decision: whisper.cpp via sidecar (whisper-server / whisper-cli)

Written 2026-04-17. **Revised** the same day after seeing Presence's
spike numbers — see [RESULTS.md](RESULTS.md) for the bench data that
changed the call.

## Initial (wrong) decision: smart-whisper N-API binding

The first cut of this doc picked `smart-whisper` (an N-API binding
to whisper.cpp). Rationale was "in-process, no IPC overhead, prebuilt
npm binary so no compile dance." All true.

What killed it: the Presence Phase 0 spike measured `whisper-cli` from
nixpkgs at **23× realtime on tiny.en, 12× realtime on base.en** on
Eric's workstation. Re-running the Moss N-API spike on the same
workstation got **2.7–5.3× realtime on tiny.en, 1.1–2.3× realtime on
base.en** — even after a clean local rebuild that should have picked
up the host's CPU features. The gap is consistent ~4–9× and survives
threading + sampling tuning.

I don't have a clean theory for the size of the gap (npm prebuild
vs. nixpkgs build of the same library should not differ this much
even without CPU-specific extensions), but the bench data is
unambiguous: the N-API path is much slower in practice. Whatever the
cause, the smart-whisper bench also segfaulted on `free()` in one of
the runs, which is its own reliability concern for shipping.

## Chosen: sidecar process running whisper.cpp

Specifically: `whisper-server` from upstream whisper.cpp. Spawn it
once on first ASR session open, leave it running with the model
loaded, POST PCM/WAV chunks for inference, parse JSON back. Kill it
on idle timeout.

This matches:

1. **Presence's already-validated choice.** Same runtime, same
   model files, comparable perf numbers. One less moving part
   when reconciling between the two repos.
2. **Moss's existing binary-shipping pattern.** Holochain, lair,
   kitsune2-bootstrap-srv all ship as per-platform binaries
   fetched at `yarn setup` from a GitHub release. whisper-cli /
   whisper-server can use the same path.
3. **Process isolation.** Model OOM or a whisper.cpp crash takes
   down the sidecar, not Moss main.

### Cost we're paying for the sidecar

- HTTP/multipart overhead per inference. Measured ~600 ms above
  raw whisper-cli on the JFK sample (whisper-cli direct: 920 ms;
  whisper-server multipart POST: 1559 ms). Acceptable for
  Presence's "transcribe what was said in the last few seconds"
  cadence; might bite for live captioning. We can swap whisper-server
  for a custom thin wrapper later if HTTP is the bottleneck.
- We have to build and host per-platform whisper-cli binaries.
  Upstream whisper.cpp does not publish prebuilt release artifacts
  the way holochain/holochain does. Either we build them in our own
  CI (matches the holochain-binaries pattern), or we vendor a
  source-build into `yarn setup`. CI build is cleaner for end users.
- PCM crosses a process boundary. At 32 KB/s per session this is
  trivial (see plan's risk list).

### Sidecar layering for Moss-side shipping

```
                  ┌─────────────────────────────────────┐
Tool iframe       │ WeaveClient.localModels.asr         │
   ↕ postMessage  └─────────────────────────────────────┘
                                   ↕
                  ┌─────────────────────────────────────┐
Moss renderer     │ asr session proxy                   │
   ↕ IPC          └─────────────────────────────────────┘
                                   ↕
                  ┌─────────────────────────────────────┐
Moss main         │ asr broker (utilityProcess)         │
   ↕ HTTP loopback└─────────────────────────────────────┘
                                   ↕
                  ┌─────────────────────────────────────┐
Sidecar process   │ whisper-server + ggml model         │
                  └─────────────────────────────────────┘
```

The broker is the M1 deliverable. The sidecar is what's validated
in M0.

## Other options weighed

### MLX + whisper (Apple Silicon only)

- Fastest option on M-series Macs. Platform-specific. Not v1.

### faster-whisper (Python via IPC)

- Best CPU accuracy/latency, but requires shipping Python with Moss.
  No.

### LiteRT-LM / MediaPipe / Gemma-ASR

- Future "we already bundle Gemma" path. Revisit post-v1.

### nodejs-whisper (CLI wrapper, builds whisper.cpp at install)

- Same end-state as the sidecar, but bundled inside an npm package
  with install-time compile. Compile on every `yarn setup` is worse
  UX than a fetched binary.

## Spike model: ggml-base.en (~141 MB)

Updated from the initial pick of tiny.en. Presence's spike concluded
base.en is the right v1 default — sweet spot of size, speed, and
quality (correct words + punctuation). tiny.en stays around as a
"low-power fallback" choice in the eventual settings pane.

## Validation target

Linux x64 (this machine). Mac/Win validation comes during M1.
