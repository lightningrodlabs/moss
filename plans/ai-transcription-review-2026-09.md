# ai-transcription branch: review, fixes, and what comes next

Written 2026-09-18 after rebasing `ai-transcription` onto `main-0.7` (21 commits over 96 upstream commits, three trivial conflicts). Companion documents: `plans/local-models-asr.md` (the original ASR intent, moved from the repo root) and `plans/services-abstraction.md` (the August design for generalizing this into host services, including the LLM harness).

## 1. Where the branch stands

The branch delivers what the intent document called M0 through M3: a whisper-server sidecar brokered in main, a `WeaveClient.localModels.asr` session API, renderer-side consent gating, a Local AI settings tab, per-platform sidecar builds, and a bundled `ggml-base.en` model in release installers. The example applet has an ASR test panel and there is a tool-author guide at `docs/build/transcription.md`.

After the rebase and the fixes below, `yarn typecheck` and `yarn test:unit` are green. The real-binary integration test in `whisperServer.test.ts` skips unless the spike model and JFK sample are present locally, so CI does not exercise the sidecar.

What is not done from the intent document: M4 (rolling out to Presence), the `utilityProcess` isolation for the broker, partial (in-progress) transcripts, `hints` bias terms, model download UX, and manifest-declared permissions. None of those were promised for this branch.

## 2. Review findings

An eight-angle review produced 40 candidates. The ones below were verified against the code. Everything marked fixed has a test.

### Fixed on the branch in this pass

- **Pushes stalled behind inference.** `AsrSession.pushAudio` chained every push behind the in-flight transcribe. A tool pumping frames from a `MediaStreamTrackProcessor` would stall for the whole inference and its bounded capture queue would drop the audio spoken meanwhile. Pushes now append and return; transcribes are queued in audio order; `settle()` exposes the queue for tests and close. Errors from a transcribe are reported through `onError` and then the session closes itself, which is what the API docs already promised.
- **Pure silence was sent to whisper every 30 seconds.** With VAD on and no speech detected, the buffer grew to `maxBufferMs` and was force-flushed, which costs a full decode and invites whisper's silence hallucinations. The session now keeps a two-second pre-roll before speech onset and drops older silence, advancing the session clock so timestamps stay correct.
- **A dead sidecar left the buffer growing without bound.** The not-ready check in flush threw before clearing the buffer and never reached `onError`. It now reports the error and closes the session.
- **Transcripts were logged unconditionally.** Every committed utterance was written to the main-process log. Only the `MOSS_ASR_DEBUG` path remains.
- **A missing binary crashed the main process.** The spawned child had no `error` listener, so an ENOENT became an uncaught exception. It is now a `WhisperServerStartError` raised immediately instead of after the 60s readiness timeout.
- **Capabilities advertised a model that did not exist.** `defaultModelPath` returned the spike path without checking it, so a packaged build without a bundled model reported `available: true`. It now returns null and the service reports unavailable with a clear error at first use.
- **Language was accepted but never sent.** `AsrSessionOptions.language` now reaches whisper-server as the `language` form field.
- **Broker destroy raced a cold start.** A server finishing its start after `destroy()` was orphaned. Destroy now waits for the start and stops it; a session that was mid-open rejects.
- **Errored sessions leaked registry entries**, and a session whose owning window died during a cold model load was registered anyway and could never be closed. Both handled in `ipcHandlers.ts`.
- **Renderer ownership and revocation.** Any iframe that learned a session id could push audio into or close another applet's session. Push and close now verify the session belongs to the calling applet. Turning Local AI off or revoking a tool's consent now closes that tool's live sessions and tells the applet why.
- **Type drift across five hand copies of the wire types.** The preload and renderer copies of `AsrSessionOptions` had already lost the VAD fields. All layers now import the types from `@theweave/api`.
- **Two sources of truth for the whisper version.** The hard-coded fallback in `wireUp.ts` is gone; `moss.config.json#whisperServer` is required.
- **Dev setup built whisper.cpp from source.** `yarn setup` in the nix shell would fail on a missing cmake. The build is now a separate `build:whisper-server` step used by `setup:release`, and the packaging scripts require the ASR artifacts via `check:binaries:release`.
- Smaller items: sidecar output routed into Moss's log pipeline, `get-port` reused instead of a second port picker, one shared `resolveAppletName`, a typed envelope for the WAL-window relay response, and the intent document moved into `plans/`.

### Verified but deferred

- **Permission enforcement is renderer-only.** Main's handlers key ownership on webContents id, which is the main renderer for every applet. A compromised renderer bypasses consent. Fixing this needs main to know the applet identity behind a request; it intersects the applet trust-boundary work and the services abstraction, so it belongs there rather than as a patch here.
- **Sessions outlive their iframe.** Fixed 2026-09-23: the renderer bridge records which main-window iframe or WAL window opened each session, `unregister-iframe` releases that iframe's sessions, and main tells the renderer when a WAL window closes so its sessions are released too. Sessions with no recorded origin still rely on the tool's own `close()`.
- **WAL-window relay timeout versus the consent dialog.** Fixed 2026-09-23: `relayTimeoutMs` in `src/main/appletRelayPolicy.ts` gives `asr-open-session` no deadline, since the native dialog it waits on always resolves.
- **Per-frame IPC cost.** Every 10 ms audio frame is a separate postMessage, validation pass, and IPC invoke, roughly 100 per second per session. Coalescing to 100 to 200 ms batches in the applet-side session would cut that by an order of magnitude with no VAD impact. Worth doing before Presence runs many concurrent sessions.
- **The renderer bridge singleton.** Events go main → main renderer → bridge → back through main to WAL windows. Keying the registry by applet id in main would remove the bridge and a round trip; this falls out naturally from the services abstraction registry.
- **Consent store is separate from the existing tool permissions.** ASR consent lives in renderer localStorage keyed by applet hash, while camera and mic grants live in main's `ToolUserPreferences` keyed by tool id. The services plan already argues for a structured consent key; when that lands, this store should fold into it.
- **`utilityProcess` isolation** for the broker, as the intent document specified, is still open.
- Untested Electron glue: `wireUp.ts`, `asr-bridge.ts` (now covered), `local-ai-settings.ts`, and the release workflow changes cannot be checked from unit tests.

## 3. Assessment against the intent

The branch matches the intent document closely in API shape and in the three-state availability model. Two places where it drifted and the fixes above pulled it back: the streaming contract (the intent says the push model exists so tools stay simple, which a blocking push defeated) and the honesty of `capabilities()`.

The biggest structural observation is the one the services-abstraction plan already makes: the `asr-` prefix is repeated in the message union, the validation schemas, the preload, the electron-api typings, the IPC channels, and the bridge. That is six places to touch per new host service. This is fine for one service and wrong for two.

## 4. The LLM harness from acorn's clarity-forge branch

Acorn's `clarity-forge` branch (58 commits, last touched 2026-07-07, unchanged since) built its chat-with-your-tree feature against a `HarnessClient` interface with two providers. The dev provider runs a sidecar with an ACP agent subprocess or a direct OpenAI-compatible backend. The Moss provider is a stub: it feature-detects a `harness` property on the WeaveClient and throws until Moss provides one. Acorn's own header comment says the harness "is meant to be a generalized affordance Moss provides to ALL tools via the Weave host API."

What Acorn needs from Moss, in order of necessity:

1. A truthy `weaveClient.harness` member. Acorn hides the whole chat UI when it is absent.
2. `initialize()` returning `{ protocolVersion, agentName?, canLoadSession?, mcpServers? }`.
3. `newSession(opts)` returning a session with `prompt(blocks)` resolving at end of turn with a stop reason, `cancel()`, `on('update', cb)` streaming `message | thought | tool_call | plan | mode` updates, and `dispose()`.
4. A host-to-applet permission callback the host awaits: `onPermissionRequest(handler)` returning `{ outcome: 'selected', optionId } | { outcome: 'cancelled' }`.
5. A host-to-applet tool-call callback: `onToolCall(handler)` for `read_tree` and `propose_edits`, returning `{ ok, result } | { ok: false, error }`.
6. `resumeSession(id)`, because Acorn persists chat history per session id and reattaches after a renderer reload.
7. Something the current interface lacks: a way for the applet to declare its tools (name, description, JSON schema) and its system prompt and skill text at session start. In the dev sidecar these are hard-coded server-side or come from env vars. Moss cannot run Acorn's stdio MCP server, so this has to be per-session config.

### How this fits the ASR work

The ASR branch and the harness need the same five things: late-bound discovery, sessions with streamed events, per-tool consent, host-owned backend lifecycle, and host-owned configuration. The harness adds three the ASR plumbing does not have: reverse RPC (items 4 and 5), sessions that outlive the iframe (item 6), and per-session tool-supplied config (item 7).

The ASR branch's reverse path is one-directional: main pushes events out. There is no request-response channel from host to applet, and the session registry ties a session to a webContents, which is exactly wrong for a resumable session. Adding a second `harness-*` quad of message types on top of the existing `asr-*` quad would double the plumbing and still not give the harness what it needs.

### Recommendation

Follow the services-abstraction plan's M0 and M1 before writing any harness code, and do it as the next step on this branch rather than after merge:

- Replace the four `asr-*` request variants and one `asr-event` variant with the generic `service-request` / `service-event` envelope plus the two reverse-RPC variants (`service-host-request` / `service-host-response`). Keep `weaveClient.localModels` as a typed facade over the generic transport so no tool-facing API changes. The `AppletAsrSession` class and its 23 transport-level tests are the template.
- Move ownership into a `ServiceRegistry` in main keyed by `(serviceId, sessionId)` with an owner that is either a webContents id (ASR, non-resumable) or an applet id (harness, resumable, TTL-expired). This is also what removes the renderer bridge and closes the "sessions outlive their iframe" gap above.
- Generalize the consent keys to `serviceEnabled#<id>` and `serviceConsent#<id>[#<backendId>]#<appletId>`, migrating the two existing keys, and rename the settings tab from Local AI to Services. The sub-scope matters for the harness because a local Ollama backend and a hosted Claude backend have different privacy properties and must be consented separately.

Then the harness host itself (services plan M3): extract acorn's ACP client, direct backend, `promptContext.js`, and `systemSlot.js` into a shared package rather than copying them, since acorn's Kangaroo build needs the same code. Two findings from acorn are load-bearing and should not be simplified away: agents misreport system-prompt support, so the inline-prompt floor stays; and routing a local model through an ACP agent failed, so both backend families stay behind the one interface.

Sequencing question for you: whether to land `ai-transcription` first and refactor onto the generic plumbing afterwards (the facade makes that compatible), or to do M0 and M1 on this branch before merging. If Presence is waiting on the ASR API, merge first. If not, the refactor is smaller now than after the harness is added on top.

## 5. Ordered next steps

1. Decide the sequencing above.
2. Batch audio pushes in `AppletAsrSession` to 100 to 200 ms.
3. Services abstraction M0 and M1 (envelope, transport, registry, ASR port). Done when the example applet's ASR panel works unchanged and the existing main/asr suites pass.
4. M2: generalized consent keys and Services settings pane, with the consent store folded toward `ToolUserPreferences`.
5. M3: extract acorn's harness pieces into a shared package; `HarnessServiceHost` as a multi-backend broker with reverse RPC and resumable sessions.
6. M4: `weaveClient.harness` facade, fill in acorn's `MossHarnessClient`, a harness panel in the example applet, and a services developer guide generalizing `docs/build/transcription.md`.
7. Main-process permission enforcement and `utilityProcess` isolation, once main knows applet identity.
