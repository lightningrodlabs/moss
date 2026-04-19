# Moss `localModels` API — implementation plan

Working notes for adding a local-model pipeline to Moss, exposed on
`WeaveClient`. Written 2026-04-17 from the Presence repo, intended to
be carried over to the Moss repo and worked by a sibling agent session.

Sibling document: TRANSCRIPTION_PLAN.md in the Presence repo — the
consumer side of this API. When in doubt about "what does Presence
actually need," that doc is the source of truth.

## Why this belongs in Moss, not in each tool

Several Moss tools want speech-to-text (Presence for meeting
transcripts; a hypothetical notes tool; chat translation; voice
control of Moss itself). Each embedding its own ASR model means:

- Duplicated multi-GB weights on disk per tool
- Multiple models loaded into RAM when more than one tool is open
- Per-tool "do you want to download a model?" permission dialogs
- Per-tool choice of runtime (llama.cpp vs MLX vs ONNX) and
  quantization, which becomes a config nightmare for users

A single local-model pipeline at the Moss shell level amortizes all
of that. It is also the right layer for permissions: "this Moss
installation is allowed to run a local ASR model" is one decision,
not one-per-tool.

## Scope

**v1 — ASR only.** Speech-to-text for whatever audio a tool hands in.
Streaming session API (push audio, receive text as it's ready).

**Deliberately not in v1:**

- Text generation / LLM chat (different API shape, different model
  class, different cost profile)
- Translation
- Summarization, extraction, structured output
- Image / video understanding
- Embeddings

The `localModels` surface is structured so those can slot in later
as additional sub-namespaces without breaking changes.

## Public API shape

Extends `WeaveClient`:

```typescript
interface WeaveClient {
  // ... existing members ...

  /**
   * Local on-device model access. Optional — may be undefined if the
   * Moss installation has no local models configured, or if the
   * applet lacks the `localModels` permission.
   */
  localModels?: LocalModelsApi;
}

interface LocalModelsApi {
  /**
   * What's available. Tools should call this before offering
   * model-dependent UI.
   */
  capabilities(): Promise<LocalModelCapabilities>;

  asr: AsrApi;
  // Future: translate, summarize, embed, ...
}

interface LocalModelCapabilities {
  asr: {
    available: boolean;
    /** ISO 639-1 codes the runtime can transcribe. */
    languages: string[];
    /** True if the runtime supports true streaming (incremental partials).
     *  False means push-then-commit batch; Moss can still present a
     *  streaming-shaped session on top. */
    streaming: boolean;
    /** Tool-facing model identifier, for telemetry / UI only.
     *  Moss is authoritative for model choice. */
    model: string;
    /** Rough perf tier on this user's hardware + model combo. Tools use
     *  this to decide whether to offer latency-sensitive features
     *  (live captions) or only the offline use case (post-meeting
     *  transcript). Added after M0 confirmed CPU-only tiny.en at 2.6×
     *  realtime batch but slower-than-realtime per chunk in streaming
     *  emulation — the same `streaming: true` capability covers wildly
     *  different real-world UX profiles. */
    latencyTier: 'fast' | 'ok' | 'slow';
  };
}

interface AsrApi {
  /**
   * Open a streaming transcription session. The caller pushes audio
   * chunks and subscribes to partial/final text events.
   */
  openSession(opts?: AsrSessionOptions): Promise<AsrSession>;
}

interface AsrSessionOptions {
  /** ISO 639-1 code. Auto-detect if omitted. */
  language?: string;
  /** Bias terms: names, jargon, technical terms the model should
   *  prefer when ambiguous. Implementation-defined how these are
   *  applied (initial prompt, decoding bias, etc). */
  hints?: string[];
  /** PCM sample rate the caller will push. Moss resamples if needed.
   *  Caller SHOULD push 16000 Hz mono where possible. */
  sampleRate?: number;
  /** Mono vs stereo. Defaults to 1. */
  channels?: 1 | 2;
}

interface AsrSession {
  /**
   * Feed a PCM16 chunk. `endOfUtterance` is an optional hint — if the
   * caller is doing its own VAD and knows an utterance ended, passing
   * true triggers an immediate commit of any pending partial. Otherwise
   * Moss applies its own VAD / timing rules.
   */
  pushAudio(pcm16: Int16Array, endOfUtterance?: boolean): Promise<void>;

  /**
   * Incremental result updates. Text is the current best guess for
   * the in-progress utterance; may be revised by subsequent partials
   * or a final event. Unsubscribe by calling the returned function.
   */
  onPartial(cb: (ev: AsrPartialEvent) => void): () => void;

  /**
   * Committed result for a completed utterance. Final events arrive
   * in order per session.
   */
  onFinal(cb: (ev: AsrFinalEvent) => void): () => void;

  /**
   * Error channel for session-level failures (model unloaded, device
   * lost, etc.). The session is closed after an error event fires.
   */
  onError(cb: (err: Error) => void): () => void;

  /** Close the session and free any Moss-side resources. */
  close(): Promise<void>;
}

interface AsrPartialEvent {
  text: string;
  /** ms relative to session start */
  tStart: number;
  tEnd: number;
}

interface AsrFinalEvent {
  text: string;
  tStart: number;
  tEnd: number;
  /** 0.0–1.0 if the model exposes a confidence; otherwise undefined */
  confidence?: number;
  /** Detected language code if auto-detect was used and the model
   *  reports it; otherwise undefined */
  lang?: string;
}
```

### Why this shape

- **Session-scoped, not one-shot.** Tools accumulate text over long
  spans (a meeting, a continuous dictation). Forcing them to recreate
  sessions per utterance wastes model warm-up time.
- **Push model, not subscribe model.** The tool owns its audio source
  (MediaStreamTrack, file read, etc.). Moss shouldn't pull; it would
  need permissions to access the tool's audio source, which is the
  wrong direction of control.
- **Partial + final separation.** Allows future live-caption consumers
  to render partials while keeping the commit stream clean for things
  like Presence, which only wants finals.
- **Moss owns VAD / timing by default.** Callers can pass
  `endOfUtterance: true` if they have better information, but the
  common path lets Moss decide when to commit. Keeps the tool-side
  code simple.
- **PCM in, not compressed audio.** Runtimes vary in what they
  accept; Moss absorbing one format normalization (PCM16 Int16Array)
  keeps tool code uniform.

## Runtime choice (Moss-side, not exposed)

Unconstrained from the API's perspective. Reasonable first picks, in
order of expected practicality:

- **whisper.cpp** with GGUF weights, via a Node N-API binding or a
  child-process sidecar. Mature, good language coverage, well-tuned
  for edge. Not streaming-native — Moss does its own VAD chunking and
  presents a streaming API over it.
- **MLX (Apple Silicon only) with whisper weights.** Fastest on Macs.
  Moss chooses per-platform.
- **faster-whisper (Python) via IPC.** Skip unless the above are
  blocked.
- **LiteRT-LM / MediaPipe with Gemma-ASR.** The "we already have
  Gemma for other things" future — revisit after v1.

The runtime choice lives entirely inside Moss. Tools can't request a
specific model; `capabilities().asr.model` is read-only telemetry.

## Permissions

A new applet permission: `localModels` (granular sub-permissions if
useful, e.g. `localModels.asr`). Applets without this permission see
`weaveClient.localModels === undefined`. The permission UX should
follow whatever pattern Moss already uses for sensitive capabilities.

One-time consent flow on first use might be worth an additional layer:
even if the applet declared `localModels.asr` in its manifest and the
user installed it, the first time an `openSession` call happens in a
given applet, prompt: "This applet wants to transcribe audio locally.
Allow?" with an "always allow for this applet" option. Conservative
but matches user expectations about microphone-adjacent features.

## Installation / model lifecycle

Not Moss applets' problem. The Moss shell owns:

- Downloading model weights on first `localModels.asr` enablement
- Offering quantization choices in Moss settings (fast/accurate/small)
- Updating models when a new version ships
- Unloading when idle to free RAM, reloading on next session open

This implies Moss needs a "Local AI" settings pane. The scope of that
settings pane is tightly bounded for v1: model on/off, choice among a
small preset list, disk-usage display. No tweaking of sampling
parameters, no custom models.

## Implementation phases (Moss repo)

### M0 — Runtime spike (1 week) — ✅ done 2026-04-17 (Linux only)

- Pick a runtime (likely whisper.cpp for v1).
- Stand up a bare-bones Node harness in Moss that opens a model,
  accepts PCM16 over stdin, prints finals to stdout.
- Validate on the platforms Moss targets (at minimum: macOS
  arm64/x64, Linux x64, Windows x64).

**Outcome:** runtime is whisper.cpp via **sidecar** process
(`whisper-server` from upstream whisper.cpp). Default model is
`ggml-base.en` (~141 MB), per Presence's recommendation. Validated
on Linux x64: 12× realtime via direct whisper-cli, 7× realtime via
whisper-server sidecar over loopback HTTP. Spike code and full
findings in [spikes/asr-m0/](spikes/asr-m0/) — see
[RESULTS.md](spikes/asr-m0/RESULTS.md) for the bench data.

The initial pick was an N-API binding (`smart-whisper`); reverted
after measuring it 4–9× slower than `whisper-cli` on the same
hardware running the same model, even after a clean local rebuild.
See [RUNTIME_CHOICE.md](spikes/asr-m0/RUNTIME_CHOICE.md) for the
revised rationale. Mac/Win validation deferred to M1's portability
pass.

### M1 — Moss-internal ASR service (in progress 2026-04-19)

**Done so far** (all in [src/main/asr/](src/main/asr/), 78 unit tests):

- `WhisperServer` — sidecar-process wrapper (spawn, port pick, TCP
  readiness probe, multipart inference, SIGTERM/SIGKILL stop). Real
  JFK integration test passes against nixpkgs whisper-cpp.
- `AsrSession` — per-utterance buffer, push/flush with
  `endOfUtterance` flag + `maxBufferMs` safety cap, serialized
  pushes so `final` events stay in order, listener fan-out for
  final/partial/error, close-flush + idempotent close, **energy-VAD
  silence detection** (commits an utterance after `vadSilenceMs` of
  silence following speech; default 500 ms / RMS 0.01).
- `AsrBroker` — lazy model load, concurrent-session sharing,
  ref-counted idle unload with cancel-on-reacquire, race-safe
  unload, `serverFactory` test seam.
- `resolveWhisperServerCommand` — env var → bundled binary →
  nix-shell dev fallback. Pure-function with Electron-derived
  inputs injected by caller.
- **IPC + WeaveClient surface (M2).** Cross-process plumbing wired:
  preload, applet-host bridge, applet-iframe handler, validation
  schemas, and the public `WeaveClient.localModels.asr.openSession`
  API in `@theweave/api`. Exercised end-to-end from the example
  applet's `<asr-test>` panel.

**Still to do in M1:**

- **Chunking strategy must not be naïve fixed-window.** ✅ Implemented
  as energy-VAD inside `AsrSession` (2026-04-19). Per-chunk RMS gates
  silence detection; `vadSilenceMs` of post-speech silence triggers a
  commit. Falls back to the existing `maxBufferMs` cap if no silence
  is ever observed. Skipped the `whisper-vad-speech-segments` binary
  approach for now — would have required spawning the binary per
  buffer, more moving parts, no clear quality win at this stage.
  Revisit (or swap in Silero VAD) if real-world environments show the
  energy-RMS approach misfiring.
- **Build whisper-cli + whisper-server per platform via Moss CI**
  and ship into `resources/bins` the same way holochain / lair /
  kitsune2-bootstrap-srv binaries are shipped. Upstream whisper.cpp
  does not publish official prebuilt release artifacts the way
  holochain does, so we own the build. Targets: linux-x64,
  linux-arm64, mac-arm64, mac-x64, windows-x64. Resolver already
  looks for `resources/bins/whisper-server-v<version><exe>` — this
  chunk just has to produce those files.
- Sidecar wrapper choice: `whisper-server` for v1 (HTTP API,
  works out of the box, costs ~600 ms per inference vs raw whisper-cli
  in our bench). If that overhead becomes a problem under live
  captioning load, swap for a thin custom wrapper around the
  whisper.cpp library. Don't over-engineer until profiling demands it.
  - **Why HTTP loopback rather than a Unix domain socket:**
    whisper-server only exposes `--host` / `--port` — TCP only,
    no UDS flag. We bind to `127.0.0.1` on an OS-allocated
    ephemeral port, so any local code that could connect to our
    port could equally `read()` a UDS we own (same trust boundary).
    Loopback TCP is in-kernel buffer copies; UDS would shave
    microseconds off ~600 ms of multipart-parse + WAV-decode work
    that whisper-server does inside the request. The clean upgrade
    path — if profiling ever calls for it — is the custom libwhisper
    wrapper above, which can pick any transport (UDS, or in-process
    direct calls if we co-locate the broker and wrapper).
- Process model: run the broker AND the whisper-server sidecar
  outside Moss main. Broker = Electron `utilityProcess`. Sidecar
  = `child_process.spawn` from the broker. Two-process isolation
  so a model OOM kills only the sidecar, and broker restarts it.
- PCM transport from broker → sidecar can stay multipart-WAV-over-
  loopback for v1. Per-session throughput (32 KB/s) makes this fine.
  Optimize only if a profiler says to.

### M2 — WeaveClient API surface

- Implement `weaveClient.localModels.asr.openSession` per the
  interface above.
- Session objects proxy pushAudio / event subscriptions over the
  existing applet↔host IPC channel.
- Capability negotiation: `capabilities()` returns what's actually
  wired up on the host.

### M3 — Permissions + settings UI

- Manifest declaration for `localModels` / `localModels.asr`.
- First-use consent prompt.
- "Local AI" settings pane: enable/disable, model choice, disk
  usage.

### M4 — Roll out to Presence

Coordinated with the Presence branch: Presence's transcription
module reads `weaveClient.localModels?.asr` and uses it when
present; Moss builds shipping after M3 expose it. Presence's
user-configured-endpoint fallback stays for standalone builds and
for Moss installations without the feature enabled.

### Deferred

- Additional model types (text gen, translate, embed, vision).
  Each is a separate API surface under the same `localModels`
  namespace with the same shape: capability introspection, session
  or one-shot call, Moss-owned lifecycle.
- GPU/NPU selection exposed to applets. v1 is "Moss picks, tool
  consumes."
- Per-applet resource quotas. Add when we see real multi-tool
  concurrent usage.

## Risks and open questions

- **Streaming emulation over batch runtimes.** whisper.cpp is not
  truly streaming. Moss doing VAD-chunked batch calls to present a
  streaming API introduces latency floors (≥ chunk size). For
  Presence's opportunistic non-realtime use case this is fine. For a
  hypothetical live-caption tool it might not be — worth stating the
  latency profile explicitly in `capabilities()` so tools can make
  informed decisions.
- **IPC throughput for PCM.** PCM16 at 16 kHz mono is 32 KB/s per
  session. Comfortably fine per-session; becomes worth measuring if
  a tool opens many sessions (e.g., Presence volunteer fallback
  transcribing multiple peers). Sketch: ~10 concurrent sessions is
  320 KB/s, still trivial. If we ever need to scale further, a
  shared-memory / transferable-buffer path is the escape hatch.
- **Audio format normalization cost.** If a tool pushes 48 kHz
  stereo (typical WebRTC output), Moss has to resample before the
  model. Pushing the resample into the tool side is possible via
  AudioWorklet but couples tool code to Moss's expected format.
  Current choice: Moss absorbs the resample. Revisit if profiling
  says otherwise.
- **Model download UX is the hardest part for v1.** Multi-gigabyte
  download, slow, possibly failed. The "Local AI" settings pane
  needs to handle resume, progress, cancellation, integrity check.
  Budget accordingly — this is real work, not boilerplate.
- **Cross-platform performance variance.** A mid-range Linux laptop
  without GPU acceleration will have meaningfully worse latency than
  an M-series Mac. The capability result alone doesn't convey this.
  Consider including rough benchmark categories in capabilities
  (e.g., `performanceTier: 'fast' | 'ok' | 'slow'`) so tools can
  decide whether to offer features at all.
- **Test harness across Moss versions.** Once shipped, API stability
  matters. The interface sketched here is versioned implicitly via
  the `capabilities()` call; consider whether an explicit
  `apiVersion` field should appear on `LocalModelCapabilities` to
  make forward-compat negotiation cleaner.

## What the Moss-side agent should do first

1. Read this document and TRANSCRIPTION_PLAN.md (Presence repo) to
   ground in the consumer-side requirements.
2. Cut a branch (suggested name: `feature/local-models-api`).
3. Start with M0 — pick the runtime, spike the Node harness. Do not
   start on M2 (the WeaveClient surface) until M1's IPC boundary
   shape is settled; the API surface rides on top of that boundary.
4. Post results of M0 back so Presence's Phase 0c (opportunistic
   broadcast cadence) can use the real latency profile rather than
   a guess.
