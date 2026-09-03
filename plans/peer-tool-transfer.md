# Peer tool transfer: installing a group's Tools from other members

Status: implemented 2026-09-03 on branch `feat/peer-tool-transfer` (all tasks in
`plans/peer-tool-transfer-plan.md` except the manual two-agent run). Verified by
unit tests, an in-memory end-to-end test that drives the real main-process
reader/writer through the real requester and provider, `yarn typecheck`, and
`yarn build`. Not yet verified: a live two-agent transfer over Holochain remote
signals, and the real remote-signal payload ceiling (chunk size stays at
512 KiB until measured). See "Manual verification" below.

## Problem

A member who joins a group while the internet is down (for example over the
mDNS LAN build) can see the group's applets but cannot activate any of them.
`installApplet` resolves the Tool's download URL from the developer
collective's web2 tool list and fetches the webhapp over HTTPS. Offline, both
steps fail, even though other members on the same LAN have every byte of the
Tool on disk.

## Goals

- When the tool library is unreachable, obtain a Tool's happ, UI and icon from
  an online group member who has it, and install it through the existing
  install path.
- Zero additional stored data on either side. The provider serves straight from
  the files it already has; nothing is committed to the DHT or source chain.
- No group DNA change. The existing arbitrary remote-signal relay carries the
  protocol, so the pinned holochain builds keep working.
- Clear, continuous feedback to the requesting user about what is being tried,
  from whom, and how far along the transfer is.

## Non-goals (this iteration)

- Verifying the UI bytes against `sha256_ui`. See "Trust model".
- Preferring LAN peers when the tool library is reachable.
- Resuming a transfer across a Moss restart.
- Provider-side rate limiting or bandwidth caps.
- Provider-side UI.

## Existing facts the design relies on

- The `Applet` entry records `sha256_happ`, `sha256_ui` and `sha256_webhapp`
  (`dnas/group/zomes/integrity/group/src/applet.rs`). The requester therefore
  knows exactly which bytes it wants before asking anyone.
- The group coordinator zome's `recv_remote_signal` emits every incoming
  arbitrary signal to the app websocket unchanged, and `remote_signal_arbitrary`
  sends arbitrary bytes to a list of agents. `GroupClient.remoteSignalArbitrary`
  wraps this and msgpack-encodes a `GroupRemoteSignal` union
  (`shared/group-client/src/types.ts`). `GroupStore` decodes incoming signals
  and dispatches on `type` (`src/renderer/src/groups/group-store.ts`).
- `GroupStore` tracks per-agent online status via ping/pong
  (`_peerStatuses`, statuses `online` / `inactive` count as present) and
  `GroupClient.getJoinedAppletAgents` lists who has joined an applet.
- The main-process `install-applet-bundle` handler already skips the download
  when `happs/<sha256_happ>.happ` and `uis/<sha256_ui>/assets` exist
  (`src/main/index.ts`). It still requires the tool icon to be present or
  fetchable.
- The happ file on disk is byte-identical to the hashed happ bytes. The UI is
  stored unpacked; the original `ui.zip` that `sha256_ui` hashes is deleted at
  install time (`we-rust-utils/src/decode_webapp.rs`).
- Payload limits: iroh transport frames are capped at 100 MiB; the local app
  websocket at 64 MB. No explicit cap was found on zome-originated remote
  signals (the 1 MiB `DIRECT_SIGNAL_MAX_SIZE` applies to a different conductor
  API). Real Tools on a dev machine: happ 0.9-4 MB, unpacked UI 1.3-16 MB in
  3-233 files, largest single file 7.4 MB.

## Design

### Transport

One new `GroupRemoteSignal` variant:

```ts
{ type: 'tool-transfer'; payload: ToolTransferMessage }
```

Both directions use `GroupClient.remoteSignalArbitrary`. The renderer on each
side handles the messages; the main process only touches disk.

### Messages

```ts
type ToolTransferRequest = { happSha256: string; uiSha256: string; toolCompatibilityId: string };

type ToolTransferMessage =
  | ({ kind: 'request'; requestId: string; from: AgentPubKey } & ToolTransferRequest)
  | { kind: 'offer'; requestId: string; manifest: ToolTransferManifest }
  | { kind: 'unavailable'; requestId: string; reason: string }
  | ({ kind: 'chunk-request'; requestId: string; from: AgentPubKey; index: number } & ToolTransferRequest)
  | { kind: 'chunk'; requestId: string; index: number; bytes: Uint8Array };

type ToolTransferManifest = {
  happ: { sha256: string; size: number };
  ui: { sha256: string; files: Array<{ path: string; size: number; sha256: string }> };
  icon: string; // the icon file contents as stored under tools/<id>/icon
  chunkSize: number;
};
```

`requestId` is a random UUID chosen by the requester. All replies carry it so
a requester can ignore stragglers from abandoned attempts and unrelated
transfers. The group zome's arbitrary signal does not carry the sender's key,
so requester-to-provider messages include `from` to tell the provider where to
reply, and chunk requests repeat the request identity so the provider stays
stateless. Replies are matched on `requestId` alone; since it is unguessable
and signals are point-to-point, a third party cannot inject a reply.

### The byte stream

The provider exposes a virtual stream: the happ bytes, then each UI file's
bytes in manifest order. Chunk `i` is bytes `[i*chunkSize, (i+1)*chunkSize)` of
that stream. Total chunks = `ceil(totalSize / chunkSize)`. A pure module
(`chunking.ts`) owns the mapping from a chunk index to the list of
`(file, offset, length)` reads, and the inverse reassembly on the requester.
Nothing is concatenated on disk; the provider reads only the ranges a chunk
needs. UI files are listed sorted by their relative path so that the provider
can rebuild the identical manifest for every chunk request without caching.

Initial `chunkSize` is 512 KiB. Measure the actual remote-signal ceiling during
implementation and raise it if the transport allows.

### Requester algorithm (renderer, `ToolTransferRequester`)

1. Candidates = agents who joined the applet (`group_pubkey`) that are
   currently `online` or `inactive` in `_peerStatuses`, excluding self. Empty
   list means fail immediately with "no online member has this Tool".
2. For each candidate in turn:
   - send `request`; wait up to 10 s for `offer` or `unavailable`.
   - validate the manifest: hashes match the request, paths are relative with
     no `..` or leading `/`, sizes are non-negative, total under 200 MB.
   - pull chunks with a window of 4 outstanding `chunk-request`s. Each chunk
     has a 15 s timeout and 3 attempts. Progress is reported per received
     chunk.
   - on any timeout/exhaustion, abandon this peer and move to the next.
3. Hand the manifest plus assembled bytes to main via
   `store-tool-assets-from-peer`.

### Provider algorithm (renderer, `ToolTransferProvider`)

Stateless. On `request`: ask main for a manifest via `read-tool-assets-manifest`
(returns `undefined` if the happ, UI dir or icon is missing) and reply `offer`
or `unavailable`. On `chunk-request`: ask main for
`read-tool-assets-chunk(happSha256, uiSha256, index, chunkSize)` and reply
`chunk`. The provider recomputes the manifest per chunk request rather than
caching, so it holds no state across messages. Main validates that the hashes
are 64 lowercase hex characters before touching any path.

### Storing on the requester (main, `peerToolAssets.ts`)

`store-tool-assets-from-peer(manifest, bytes, expected: { happSha256, uiSha256, toolCompatibilityId })`:

1. Re-validate the manifest (same rules as the requester; main is the trust
   boundary for the filesystem).
2. Split the stream back into happ + files using the chunking module.
3. Verify sha256 of the happ against `expected.happSha256`. Mismatch throws
   and nothing is written.
4. Verify each UI file's sha256 against the manifest entry (catches
   corruption, not a malicious provider).
5. Write `happs/<happSha256>.happ` if absent, `uis/<uiSha256>/assets/<path>`
   for each file (creating directories), and the icon via
   `storeToolIconIfNecessary`.

Then the renderer calls the existing `installAppletBundle` with `appHashes`
taken from the Applet entry (`sha256_webhapp`, `sha256_happ`, `sha256_ui`) and
a new optional `assetSource` argument of `{ type: 'peer' }`. The handler finds
everything on disk and skips the download. `AssetSource` gains the `peer`
variant; `deriveAppAssetsInfo` records it.

### Fallback trigger (renderer, `MossStore.installApplet`)

The web2 branch of `installApplet` is split so the tool-library resolution and
the install call are separate steps. Flow:

1. Report `library`. Fetch the tool list with a 10 s timeout, resolve hashes
   and URL, call `installAppletBundle`.
2. If step 1 throws for any reason before the app is in the conductor, report
   `library-failed` with the error, then run the peer path with progress
   reports, then call `installAppletBundle` with the peer asset source.
3. If the peer path also fails, throw with a message that names both failures.

Trying peers after a non-network failure is acceptable for now; it costs one
request round to each online peer.

### Trust model

The happ is verified byte-for-byte against the group's record. The UI is
accepted from an authenticated group member who has joined the applet and is
checked only against the provider's own per-file hashes. A malicious member
could serve a tampered UI to an offline joiner. This is accepted for this
iteration. Two ways to close it later: retain `ui.zip` at install time so
`sha256_ui` can be verified, or record a canonical hash of the unpacked files
in the Applet entry and verify against that (requires a DNA change).

### UX: install progress

A single store on `MossStore`, keyed by applet id, so every surface that
triggers an install can show the same state:

```ts
type AppletInstallProgress =
  | { phase: 'library' }
  | { phase: 'library-failed'; error: string }
  | { phase: 'peer-search' }
  | { phase: 'peer-none' }
  | { phase: 'peer-request'; peer: AgentPubKeyB64 }
  | { phase: 'peer-download'; peer: AgentPubKeyB64; chunksDone: number; chunksTotal: number }
  | { phase: 'peer-failed'; peer: AgentPubKeyB64; error: string }
  | { phase: 'installing' }
  | { phase: 'done' }
  | { phase: 'failed'; error: string };
```

A new element `<applet-install-progress .appletHash .groupStore>` renders the
current phase as one localized line plus an `sl-progress-bar` during
`peer-download`, and resolves the peer's profile name for display:

- "Downloading from the tool library…"
- "Tool library unreachable. Looking for group members who have this Tool…"
- "No online group member has this Tool."
- "Requesting Tool from {name}…"
- "Receiving from {name}…" with a progress bar and "{done} / {total}"
- "Transfer from {name} failed. Trying the next member…"
- "Installing…"

It is shown in `group-home` beneath the card whose Activate button is loading,
and in `tool-info-dialog` beneath the Activate button. Final success/failure
toasts stay as they are. The progress entry is cleared when the install
finishes or fails. All strings go through `msg()` with translations in the
eight target locales.

## Files

- `shared/group-client/src/types.ts`: `tool-transfer` signal variant and the
  message/manifest types.
- `shared/types/src/types.ts`: `AssetSource` `peer` variant;
  `AppletInstallProgress`.
- `src/renderer/src/groups/tool-transfer/chunking.ts` (pure), `requester.ts`,
  `provider.ts`, `chunking.test.ts`, `requester.test.ts` (fake transport).
- `src/renderer/src/groups/group-store.ts`: dispatch `tool-transfer` signals to
  the provider/requester; expose `onlineAppletPeers(appletHash)`.
- `src/renderer/src/moss-store.ts`: split `installApplet`, add the fallback and
  the progress store.
- `src/renderer/src/groups/elements/applet-install-progress.ts` plus uses in
  `group-home.ts` and `app/dialogs/tool-info-dialog.ts`.
- `src/main/peerToolAssets.ts` with `peerToolAssets.test.ts` (temp dir); three
  `ipcMain.handle` registrations in `src/main/index.ts`; bridges in
  `src/preload/admin.ts`; typings in `src/renderer/src/electron-api.ts`.
- `src/main/filesystem.ts`: `deriveAppAssetsInfo` accepts an asset source.
- `src/renderer/xliff/*.xlf` and generated locale modules.

## Manual verification (still to do)

Two agents on one machine are enough. Agent 1 installs a Tool from a real
developer-collective tool list while online. Agent 2 joins the group, sees the
applet, and must not be able to reach the tool list when activating it.

The cheapest way to cut only agent 2's HTTP without touching its Holochain
traffic is a dead proxy for its Chromium network stack: launch agent 2's
Electron with `--proxy-server=127.0.0.1:9`. Both renderer `fetch` and main's
`net.fetch` go through Chromium and fail fast; the holochain subprocess does
not use the proxy, so the two conductors still talk. This recipe has not been
exercised yet; if the flag does not reach Electron through electron-vite, pull
the machine's network cable after both agents show each other online instead.

Expected on agent 2 beneath the Activate button: library download, then
"Tool library unreachable…", then "Requesting Tool from <agent 1>…", then a
progress bar, then "Installing…", then the "Tool installed." toast, and the
Tool opens. Then repeat with `TOOL_TRANSFER_CHUNK_SIZE` raised (for example to
4 MiB) to find the remote-signal ceiling, and record it here.

## Testing

- Unit (`yarn test:unit`): chunk index to file-range mapping and round-trip
  reassembly across file boundaries; manifest validation rejects traversal,
  absolute paths and hash mismatches; requester state machine against a fake
  transport (offer timeout moves to next peer, chunk retry, window, progress
  callbacks); main module reads manifest and chunks from a temp profile dir
  and stores a stream back to canonical paths, rejecting a wrong happ hash.
- The IPC drift test covers the new channels automatically.
- Manual: two dev agents, one with a Tool installed, the other with network
  access to the tool library blocked (or the tool list URL pointed at an
  unreachable host); activate the Tool and watch the progress line.
