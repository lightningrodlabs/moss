# Applet channel: design decisions

Status: agreed 2026-09-28, revised the same day after a plan review, not yet implemented. Delivery is PR 0 (local defect fixes), then PR 1 (host-side channel), then PR 2 (applet side). Each PR branches off `main-0.7`. Each merge is cherry-picked into `feat/hello-pok-fieldtest`.

Source: architecture review of 2026-09-23, candidate 1. Glossary terms are in `CONTEXT.md`.

## Problem

Knowledge of the host-to-frame message protocol is spread across about ten modules. There are two dispatchers (main window, WAL window) and four outbound send paths. Verified defects:

- A request that fails its schema check runs no handler and replies `success` with an `undefined` result (`applet-host.ts` handleAppletIframeMessage).
- The WAL window rejects `sign-zome-call` from a Cross-group view. The main window allows it.
- The WAL window silently ignores an unrecognized origin. The main window replies with an error.
- Readiness gates only `AppletStore.host`. Broadcasts are not gated, and `beforeunload` uses 10 s and 5 s timer guesses.
- `IframeStore.markReady` matches on source alone. All iframes relayed from WAL windows share `'wal-window'`, so only the first one can be marked ready.
- The timeout message claims the iframe reported ready also on the DOM-fallback path.
- `utils.ts` `postMessageToIframe` has no callers.

## Decisions

| # | Decision |
|---|----------|
| Q1 | New branch off `main-0.7` in a worktree. Cherry-pick into the field-test branch after merge. |
| Q2 | PR 1: host side, including readiness. PR 2: applet side. |
| Q3 | The channel owns the wire only: identity from origin, schema check, reply envelope, timeouts, readiness, and routing by request type. Handlers live in a table keyed by request type, outside the channel. Main window and WAL window are two adapters that supply different handler tables. |
| Q4 | One Signing scope rule everywhere: the current main-window rule. A Cross-group view may sign for every Applet of its Tool, also in a WAL window. |
| Q5 | A request that fails its schema check gets an error reply that names the request type and the failure. |
| Q6 | Keep the TypeBox schemas in the renderer and the request union in `libs/api`. The compile-time check that each schema's static type and the matching union member are mutually assignable is deferred to a follow-up PR, because no listed defect depends on it. |
| Q7 | Broadcasts to a frame that is not ready are queued and sent when it reports ready, and dropped if it is torn down first. The request timeout defaults to 20 s and each channel can set its own value. |
| Q8 | Main-window frames are keyed by their `MessageEvent.source` window object. Frames relayed from a WAL window are keyed by WAL window id plus Applet. No applet-side change. |
| Q9 | PR 1 keeps the DOM fallback for frames that never send ready, inside the channel, and fixes the timeout message. PR 2 adds a terminal "not installed" signal from the applet side and deletes the fallback. |
| Q10 | The channel exposes two outbound operations: request to one frame with reply, and broadcast to frames that match a filter. The WAL adapter's broadcast is the IPC fan-out. The three live outbound paths use the channel or are deleted, and `postMessageToIframe` is deleted. |
| Q11 | The `default-app://` listener in `moss-app.ts` stays out of scope. The channel ignores that origin explicitly. |
| Q12 | Module location: `src/renderer/src/applets/applet-channel/`. Tests: vitest in node, Node's built-in `MessageChannel` for reply ports, fake origins, stub handler table. CI already runs `yarn test:unit`. |
| Q13 | The WAL adapter signs Applet iframe zome calls locally, with scope "this Applet". It forwards Cross-group view `sign-zome-call` to the main dispatcher. |
| Q14 | An unrecognized origin gets an error reply in both windows. `default-app://` is ignored in both. |
| Q15 | The pre-ready queue keeps every message in order, up to a fixed cap per frame. Past the cap, the oldest message is dropped with a warning. `on-before-unload` is never queued: a frame that is not ready has nothing to save, so it counts as answered at once. Messages are not coalesced by type, because `remote-signal-received`, `asr-event` and `asset-store-update` are event streams, and coalescing them would lose events. |
| Q16 | PR 2, optional: move the main-process per-type relay timeout table (`relayTimeoutMs`) into a shared module used by the main process, the host channel and the applet channel. Interactive requests have no timeout. |
| Q17 | PR 1 is one PR with ordered commits, each green: (1) channel and its tests in isolation, (2) main window uses the channel, (3) WAL window uses the channel as the second adapter, (4) outbound paths and readiness move into the channel, (5) delete the timer guesses and the duplicate WAL dispatcher. Handler bodies stay in `applet-host.ts` as the main-window handler table. |

## PR 0: local defect fixes

PR 0 is small and goes first, merged to `main-0.7` and cherry-picked into the field-test branch. Each fix gets its own failing test first. None of them needs the channel.

1. A request that fails its schema check gets an error reply (Q5).
2. The WAL window forwards `sign-zome-call` from a Cross-group view to the main dispatcher over the existing relay, instead of rejecting it (Q4, Q13). The main dispatcher applies the single Signing scope rule.
3. The WAL window replies with an error to an unrecognized origin (Q14).
4. The timeout message no longer claims the iframe reported ready on the DOM-fallback path.
5. Add the missing `break` after `remote-signal-received` in the applet iframe.
6. Delete `postMessageToIframe` from `utils.ts`.

PR 1 then carries only the structural problems: readiness keyed by source for WAL frames, broadcasts that do not wait for readiness, the `beforeunload` timer guesses, and the two dispatchers whose drift caused the defects above.

## Go/no-go for PR 1

Checked 2026-09-28 unless marked open.

- Protocol keeps changing: yes. `libs/api/src/types.ts` changed in 10 commits on `main-0.7` in six months, the ASR work added request types, and `plans/services-abstraction.md` adds more.
- Cherry-pick into the field-test branch applies cleanly: yes. The field-test branch contains all of `main-0.7`, and since the merge base it changes one renderer file, `library-tool-details.ts`, which PR 1 does not touch. Measure again before each cherry-pick.
- Tests without Electron: required. If commit 1 cannot test the channel in node alone, stop and reconsider.
- Size: PR 1 must fit in about one week. If commit 1 takes more than two days, cut scope before continuing.
- Structural bugs reach users: open. The readiness race was a field bug before. Whether field-test users hit the WAL-window readiness key or pre-ready broadcasts is not measured.

## PR 2 scope (applet side)

- Merge the applet iframe's two listeners and two dispatchers into one.
- Add the applet-side request timeout from the shared table (Q16).
- Send a terminal "not installed" signal, then delete the host DOM fallback (Q9).

## Follow-up

- The field-level schema check from Q6.

## Facts relied on

- Both ends of the wire ship inside Moss. The applet-iframe script is served by Moss and injected into every Applet. A Tool's `WeaveClient` only reads `window.__WEAVE_API__`. The `get-applet-iframe-script` request must keep working for older `WeaveClient` builds.
- The applet side already rejects its promise on an `{type: 'error'}` reply.
- The main-process relay for WAL-window requests already uses the success/error envelope and a per-type timeout.
