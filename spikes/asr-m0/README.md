# M0 spike — ASR runtime validation

Goal: prove a whisper-based runtime can run inside Moss, transcribe
PCM16 audio, and emit text — no permissions, no API surface, no IPC
broker, no shipping concerns. Just: does the bottom of the stack work?

See `RUNTIME_CHOICE.md` for why `smart-whisper` was chosen.

## Setup

```bash
# from inside spikes/asr-m0/
yarn install            # builds smart-whisper from source (needs cmake + C++ toolchain)
yarn fetch-model        # downloads ggml-tiny.en.bin (~75 MB) into ./models/
```

If `yarn install` fails on whisper.cpp compile, you're probably outside
the moss `nix develop` shell — that shell provides cmake / clang.

## Harness usage

### Batch mode (validates the runtime)

```bash
# transcribe a WAV file in one shot
yarn harness:batch path/to/sample.wav

# or pipe raw PCM16 mono @ 16 kHz on stdin
ffmpeg -i some.mp3 -f s16le -ar 16000 -ac 1 - | yarn harness:batch -
```

Emits a single JSON line per segment to stdout:

```json
{"type":"final","text":"and so my fellow Americans","tStart":0,"tEnd":2480}
{"type":"final","text":"ask not what your country can do for you","tStart":2480,"tEnd":5240}
```

### Streaming mode (validates VAD + chunking emulation)

```bash
ffmpeg -i some.mp3 -f s16le -ar 16000 -ac 1 - | yarn harness:stream
```

Same JSON-lines protocol, but emits `partial` events (current best
guess for the in-progress utterance) interleaved with `final` events
(committed utterances). Streaming is emulated on top of whisper.cpp's
non-streaming runtime via fixed-window batching with overlap.

### Self-contained demo

```bash
yarn demo
```

Runs the bundled JFK sample (downloaded by `fetch-model`) through both
harnesses and prints latency stats. Use this for a one-shot sanity
check of the whole pipeline without needing ffmpeg.

## Output protocol (JSON lines on stdout)

| field          | type    | notes                                                     |
| -------------- | ------- | --------------------------------------------------------- |
| `type`         | string  | `"partial"` \| `"final"` \| `"error"` \| `"capabilities"` |
| `text`         | string  | for partial/final                                         |
| `tStart`       | number  | ms relative to session start                              |
| `tEnd`         | number  | ms relative to session start                              |
| `confidence?`  | number  | 0.0–1.0 if available                                      |
| `lang?`        | string  | ISO 639-1, if auto-detected                               |
| `error?`       | string  | for type=error                                            |

This is intentionally close to the public `AsrPartialEvent` /
`AsrFinalEvent` interfaces in the plan — the M1 broker will translate
between this stdout protocol and the in-process IPC channel.

## What success looks like for M0

1. `yarn install` completes on Linux x64.
2. `yarn fetch-model` downloads the model.
3. `yarn demo` prints recognizable text from the JFK sample.
4. Latency log shows transcription faster than realtime on this hardware.

That's it. M0 doesn't validate Mac/Win (that's M1's portability pass)
and doesn't validate the public API (that's M2). It just answers:
*does the runtime we picked actually work?*
