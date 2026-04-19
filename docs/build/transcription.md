# Adding Audio Transcription to a Moss Tool

Moss provides on-device speech-to-text to Tools via `WeaveClient.localModels.asr`.
The ASR runtime (whisper.cpp) and model lifecycle are owned by the Moss shell,
so a Tool adds transcription without bundling weights, handling downloads,
or prompting for its own model-loading consent.

This guide covers everything a Tool needs to integrate. It's written to be
readable cover-to-cover the first time, and scannable as reference after.

## When to use it

Reach for `localModels.asr` when your Tool has:

- Real-time or post-hoc transcription of audio the user produces
  (meeting transcripts, voice notes, dictation, accessibility captions).
- Audio the Tool already has permission to read — microphone input, file
  imports, a WebRTC track, etc. Moss does not pull audio; the Tool pushes it.

Avoid it for:

- Text-to-speech (not in scope for v1).
- Translation (separate `localModels` sub-namespace when added).
- Streaming transcripts across multiple peers over the network — this is an
  on-device facility. Broadcast is the Tool's responsibility.

## Feature detection

`weaveClient.localModels` is **optional**. It is `undefined` when:

- The Moss installation has no local-model pipeline configured, or
- The Tool doesn't have the `localModels` permission (manifest + settings).

Always feature-detect before calling. A Tool that depends on transcription
should degrade gracefully — typical strategies:

- **Hide or disable** the transcription UI.
- **Fall back to a remote endpoint** the user has configured for standalone
  builds of the Tool (Presence does this).
- **Prompt the user** to enable Local AI in Moss settings.

```ts
const asr = weaveClient.localModels;
if (!asr) {
  // No Moss-hosted ASR available. Fall back or hide UI.
}
```

## Capabilities introspection

Before offering model-dependent UI, call `capabilities()`. The host may be
present but have no model configured (`available: false`), or may expose a
model with a different language set or latency profile than your Tool expects.

```ts
const caps = await weaveClient.localModels!.capabilities();
// caps.asr: {
//   available: boolean;
//   languages: string[];       // ISO 639-1 codes (e.g. ['en'] or the full multilingual set)
//   streaming: boolean;        // false in v1 — partials are not emitted
//   model: string;             // 'base.en', 'large-v3', etc. — telemetry only
//   latencyTier: 'fast' | 'ok' | 'slow';
// }
```

Use the fields like so:

- **`available`** — if false, do not call `openSession()`; it will reject.
  Surface a message pointing the user at Moss settings → Local AI.
- **`languages`** — gate your language picker to this list. A single-language
  model (e.g. `base.en`) returns `['en']`; a multilingual model returns the
  full whisper set (~99 codes).
- **`streaming`** — currently always `false`. If you need live partials
  for a caption UI, expect only committed utterance-boundary finals.
- **`model`** — use for diagnostic logging only. Do not branch on it; Moss
  may upgrade models between releases.
- **`latencyTier`** — `'fast'` means live captioning is viable; `'ok'` means
  prefer post-hoc transcripts; `'slow'` means avoid interactive use. This is
  a per-install setting today, not a benchmark. Treat it as advisory.

Cache the result for the life of the Tool session; capabilities do not change
at runtime.

## Opening a session

A session is the unit of transcription work. It batches audio, commits
finals at utterance boundaries, and holds a reference on the Moss-side
model (while any session is open, the model stays loaded).

```ts
const session = await weaveClient.localModels!.asr.openSession({
  language: 'en',          // optional; ISO 639-1. Omit for auto-detect.
  sampleRate: 48_000,      // optional; the rate of PCM you will push. Moss resamples.
  channels: 1,             // optional; 1 (default) or 2.
  maxBufferMs: 30_000,     // optional; force-flush threshold if silence never arrives.
});
```

The session stays alive until you call `close()`. Sessions are owned by
your iframe — navigating away or closing the iframe releases them
automatically, but always `close()` explicitly when the feature is done.

## Pushing audio

Moss expects **PCM16** (signed 16-bit little-endian, what `Int16Array`
holds natively). Mono is strongly preferred; if you push stereo, Moss
collapses to mono.

```ts
// pcm16 is an Int16Array of PCM samples at the session's sampleRate.
await session.pushAudio(pcm16);
```

### `endOfUtterance`

Pass `endOfUtterance: true` when you *know* an utterance just ended —
e.g. you implemented your own VAD or the user hit "stop speaking."
Moss will immediately commit whatever is buffered and fire a `final`
event. Without this flag, Moss runs its own energy-based VAD and commits
after ~500 ms of silence (or when `maxBufferMs` is hit).

```ts
await session.pushAudio(pcm16, /* endOfUtterance */ true);
```

You can push from any audio source. Common sources:

- **`MediaStreamTrack`** — via `MediaStreamTrackProcessor` + an
  `AudioData` → `Int16Array` conversion (see full example below).
- **File imports** — decode with `AudioContext.decodeAudioData`, then
  flatten to `Int16Array`.
- **WebRTC remote tracks** — same as local mic, just attach to the
  remote `MediaStreamTrack`.

### Converting `AudioData` to PCM16

`MediaStreamTrackProcessor` emits `AudioData` frames of `f32-planar`
samples. Convert them like this:

```ts
function audioDataToPcm16(frame: AudioData): Int16Array {
  const samples = frame.numberOfFrames;
  const fp = new Float32Array(samples);
  frame.copyTo(fp, { planeIndex: 0, format: 'f32-planar' });
  const out = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    const s = Math.max(-1, Math.min(1, fp[i]));
    out[i] = Math.round(s * 32767);
  }
  return out;
}
```

## Receiving transcripts

Subscribe before pushing audio so you don't miss a fast-arriving final.

```ts
const offFinal = session.onFinal((ev) => {
  console.log(`[${ev.tStart}–${ev.tEnd}ms] ${ev.text}`);
});

const offError = session.onError((err) => {
  // Terminal — the session is already closed by Moss when this fires.
  showError(err.message);
});

// Partials are not emitted in v1 — this subscribes to nothing but is
// safe to wire up so your code is ready when streaming lands.
const offPartial = session.onPartial(() => {});

// Later, when you're done:
offFinal();
offError();
offPartial();
await session.close();
```

### What an event looks like

```ts
interface AsrFinalEvent {
  text: string;          // the transcribed utterance
  tStart: number;        // ms from session start
  tEnd: number;
  confidence?: number;   // 0..1 if the model exposes it; often undefined
  lang?: string;         // detected language code, if auto-detect was used
}
```

Finals arrive **in order** per session and each represents one committed
utterance. Don't assume a maximum length — a long run-on sentence may
arrive as a single event if the speaker never pauses.

## Closing

Always close sessions. `close()` is idempotent and flushes any buffered
audio before releasing the Moss-side model reference:

```ts
await session.close();
```

Closing the last session on a Moss install allows the model to unload
after an idle timeout (5 min by default), freeing RAM.

Errors from `close()` are swallowed — by the time you're tearing down,
the session has already released its resources.

## Full example — mic capture

```ts
import type { AsrFinalEvent, AsrSession } from '@theweave/api';

async function startDictation(weaveClient: WeaveClient): Promise<AsrSession> {
  if (!weaveClient.localModels) throw new Error('Local ASR unavailable');
  const caps = await weaveClient.localModels.capabilities();
  if (!caps.asr.available) throw new Error('No ASR model configured in Moss');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const track = stream.getAudioTracks()[0];
  const sampleRate = track.getSettings().sampleRate ?? 48_000;

  const session = await weaveClient.localModels.asr.openSession({
    language: 'en',
    sampleRate,
    channels: 1,
  });

  session.onFinal((ev: AsrFinalEvent) => {
    renderTranscriptLine(ev.text, ev.tStart, ev.tEnd);
  });
  session.onError((err) => console.error('ASR error', err));

  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();
  void (async () => {
    while (true) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;
      const pcm16 = audioDataToPcm16(frame);
      frame.close();
      try {
        await session.pushAudio(pcm16);
      } catch {
        // session closed mid-stream; bail out
        break;
      }
    }
  })();

  return session;
}

async function stopDictation(session: AsrSession): Promise<void> {
  await session.close();
}
```

## Error handling

Failures fall into three buckets:

1. **No host** — `weaveClient.localModels === undefined`. Feature-detect,
   show fallback UI. Not an error — the Tool was simply installed in a
   Moss without this capability.
2. **No model** — `capabilities().asr.available === false`. Surface a
   message directing the user to Moss settings.
3. **Runtime failure** — a thrown error from `openSession` /
   `pushAudio`, or an `onError` event. Treat any of these as terminal
   for the session; open a new one if the user retries.

Runtime errors you may see:

- Sidecar crash / model OOM — typically reported on `onError`; the
  session is already closed.
- Malformed PCM — `pushAudio` rejects with `"PCM payload has odd byte
  length"` if the `Int16Array`'s byte length isn't even. Shouldn't
  happen with the standard conversion.
- Session not owned by caller — won't happen in normal Tool code;
  indicates a bug in Moss's routing.

## Fallback strategy (for Tools shipped outside Moss)

Tools that also run as standalone Holochain apps (no Moss shell) will
see `weaveClient.localModels === undefined`. Common pattern:

```ts
interface Transcriber {
  openSession(opts: { language?: string }): Promise<Session>;
}

function resolveTranscriber(weaveClient: WeaveClient): Transcriber | null {
  if (weaveClient.localModels) {
    return new MossTranscriber(weaveClient.localModels);
  }
  // Fall back to a user-configured remote endpoint, or null if none.
  return loadConfiguredRemoteTranscriber();
}
```

Keep the Tool-internal abstraction thin — the shapes exposed by
`weaveClient.localModels.asr` are designed to be easy to mirror.

## Type reference

All types are exported from `@theweave/api`:

```ts
import type {
  AsrSession,
  AsrSessionOptions,
  AsrFinalEvent,
  AsrPartialEvent,
  LocalModelCapabilities,
  LocalAsrCapabilities,
  LocalModelsApi,
} from '@theweave/api';
```

See [`libs/api/src/asr.ts`](../../libs/api/src/asr.ts) and
[`libs/api/src/types.ts`](../../libs/api/src/types.ts) for the
authoritative definitions.

## Implementation notes for agents

If you're an agent adding transcription to a Moss Tool, a few things
worth internalizing up front:

- **Don't add a VAD** unless you have a real reason to. Moss's own
  energy-based VAD commits after 500 ms of silence, which is fine for
  most dictation and meeting-transcript flows. If you do implement your
  own (e.g. to cut utterances by speaker turn), pass
  `endOfUtterance: true` at your boundary and trust Moss to still
  flush buffered audio.
- **Don't retry a failed session.** Errors are terminal; open a new
  session instead. This matches how the Moss side tears things down
  after an error.
- **Don't sniff `capabilities().asr.model`.** Branching on the model
  string couples your Tool to a specific Moss release. The capability
  fields (`languages`, `streaming`, `latencyTier`) are the supported
  contract.
- **Don't assume partials.** If your UI needs live captions now,
  render with a delay or a spinner until the next `onFinal`. When
  `streaming: true` ships, you can start honoring `onPartial`.
- **Don't sample-rate convert client-side.** Moss resamples internally.
  Push whatever rate your source emits (typically 48 kHz for WebRTC,
  16 kHz for file imports) and tell the session via
  `openSession({ sampleRate })`.

## Where to look in the Moss source

If you need to read implementation detail (you usually won't):

- Public API types: [`libs/api/src/asr.ts`](../../libs/api/src/asr.ts),
  [`libs/api/src/types.ts`](../../libs/api/src/types.ts)
- Iframe-side wiring (how the API talks to the host):
  [`iframes/applet-iframe/src/index.ts`](../../iframes/applet-iframe/src/index.ts)
  search for `localModels`.
- Host-side (Moss main process): [`src/main/asr/`](../../src/main/asr/)
- Renderer bridge (session routing, events back to the iframe):
  [`src/renderer/src/applets/asr-bridge.ts`](../../src/renderer/src/applets/asr-bridge.ts),
  [`src/renderer/src/applets/applet-host.ts`](../../src/renderer/src/applets/applet-host.ts)

## What's planned for later

`localModels` is designed to grow. Tools should continue to feature-
detect everything they use — new sub-namespaces and capability fields
will land without breaking existing integrations.

Currently planned:

- True streaming partials (`capabilities().asr.streaming === true`) on
  runtimes that support them.
- Translation, summarization, and embedding namespaces under
  `localModels`.
- Per-install model selection (fast vs accurate) via Moss settings.
- Manifest-declared `localModels.asr` permission + first-use consent
  prompt.

See [`MOSS_LOCAL_MODELS_PLAN.md`](../../MOSS_LOCAL_MODELS_PLAN.md) for
the full roadmap.
