# Embed activation UX — Path 2: offline DNA-hash lookup

## Goal

Same user-visible outcome as Path 1 — when `<wal-embed>` can't load because its Tool isn't activated, show *"This asset cannot be loaded until **\<Tool Name\>** is activated"* + an Activate button that opens `tool-info-dialog`. The difference: Path 2 resolves the WAL → Tool mapping **at lookup time from the WAL alone**, with no per-context hint. This handles every embed everywhere, including legacy dashboard tiles, hand-typed WAL URLs, deeplinks, and applet-shared WALs.

The mechanism: compute candidate cell DNA hashes for every Applet entry registered in every group the user belongs to, using the same offline algorithm Holochain uses at install time, then match the WAL's DnaHash against the resulting (dnaHash → appletHash) index.

## Why this is feasible

Holochain already computes DNA hashes from a `.happ`/`.dna` bundle + `DnaModifiersOpt` (network seed + properties) offline — no conductor install required:

- [crates/holochain_types/src/dna/dna_bundle.rs:36-48](../holochain/crates/holochain_types/src/dna/dna_bundle.rs#L36-L48): `DnaBundle::into_dna_file(override_modifiers: DnaModifiersOpt) -> (DnaFile, DnaHash)`
- The `hc dna hash` CLI ([crates/hc_bundle/src/cli.rs:338-344](../holochain/crates/hc_bundle/src/cli.rs#L338-L344)) is exactly this call wrapped in a binary.

So the whole capability is one FFI call away. We just need it on the renderer side.

## Pieces of work

### 1. Native helper in `we-rust-utils`

Repo: [we-rust-utils](../we-rust-utils) (sibling).

Add a NAPI export:

```rust
/// Given a .happ bundle and per-role modifier overrides, return the
/// DnaHash that the conductor would assign to each role's DNA when
/// installed with those modifiers.
#[napi]
pub async fn happ_dna_hashes(
    happ_bytes: Buffer,
    network_seed: Option<String>,
    /// JSON map of role_name -> YAML bytes (matches Applet.properties shape)
    role_properties_yaml: Option<HashMap<String, Buffer>>,
) -> napi::Result<HashMap<String /* role_name */, String /* DnaHash b64 */>>
```

Implementation sketch:

1. `AppBundle::unpack(happ_bytes)` to get the webapp/happ bundle.
2. For each role manifest in the happ:
   - Resolve the inner `DnaBundle` (already in the happ resources).
   - Build a `DnaModifiersOpt` from `network_seed` + the role's properties override.
   - Call `dna_bundle.into_dna_file(modifiers).await?.1` to get the `DnaHash`.
3. Collect into a `role_name -> DnaHash` map and return base64-encoded hashes.

Notes:
- This is the same computation `installApp` performs internally; the resulting hashes will match the conductor's once the same Applet is installed.
- Wrap in async because zome WASM hashing is CPU-bound; let NAPI move it off the JS thread.
- Cache nothing inside Rust — caching lives in the renderer (it knows when applets are added/removed).

Tests in `we-rust-utils`:
- Round-trip: take a known happ, compute hashes, install via tryorama, compare conductor-reported DNA hashes.

### 2. Renderer index: `dnaHash → unjoinedApplet` map

File: [src/renderer/src/moss-store.ts](../src/renderer/src/moss-store.ts) (alongside the existing `dnaLocations`/`hrlLocations`).

Add a new lazy store:

```ts
unactivatedAppletByDnaHash: LazyStore<ReadonlyMap<DnaHashB64, {
  groupDnaHash: DnaHash;
  appletHash: EntryHash;
  toolName: string;
  toolIcon: string | undefined;
}>>;
```

Build algorithm:

1. Subscribe to `groupStores` for the current user.
2. For each group, subscribe to `unjoinedApplets` and (optionally) `allMyDisabledApplets`. Iterate both unioned with `appletStores` skipped (joined-and-running is already covered by `dnaLocations`).
3. For each candidate `appletHash`:
   - Get the Applet entry: `groupStore.applets.get(appletHash)` → `Applet`.
   - Ensure the `.happ` bundle is cached locally — the file already lives under `~/.config/Moss/profiles/<p>/happs/<sha256_happ>.happ` for joined applets. For applets that have never been installed locally we need to fetch the .happ, just like `installApplet` does at install time. Reuse the existing `mossStore.fetchAndStoreHapp(applet)` (or equivalent) — extract into a function that fetches without installing if needed.
   - Convert `Applet.properties: Record<string, Uint8Array>` → role-properties map for the helper.
   - Call `weRustUtils.happDnaHashes(happBytes, applet.network_seed, applet.properties)`.
   - For each resulting `dnaHash`, record `{ groupDnaHash, appletHash, toolName: applet.custom_name, toolIcon: resolveToolIcon(applet) }`.
4. Resolve tool icon via the existing `mossStore.toolInfoFromRemote(...)` path (`distribution_info → toolListUrl/toolId/versionBranch`). Cache aggressively — happ DNA hashes are stable for a given `(sha256_happ, network_seed, properties)` tuple.

Cache key:

```
sha256_happ + ':' + network_seed + ':' + sha256(properties)
→ Record<roleName, DnaHashB64>
```

Persist this cache (e.g. in `mossStore.mossCache`) so we don't recompute on every renderer launch — these tuples never change for an Applet entry.

Invalidation:
- Recompute when `unjoinedApplets` (or disabled applets) for a group changes.
- Drop entries when the applet is removed from the group (archive flow).

### 3. Host API on `WeaveServices`

File: [src/renderer/src/applets/applet-host.ts](../src/renderer/src/applets/applet-host.ts), in `buildHeadlessWeaveClient`.

Add:

```ts
assets.unactivatedAppletForWal(wal: WAL): Promise<{
  appletHash: EntryHash;
  groupDnaHash: DnaHash;
  toolName: string;
  toolIcon: string | undefined;
} | undefined>
```

Implementation:
1. `dnaHash = wal.hrl[0]`.
2. `await toPromise(mossStore.unactivatedAppletByDnaHash)` → lookup by `encodeHashToBase64(dnaHash)`.
3. Return the entry or `undefined`.

Also export this method through `@theweave/api`'s `WeaveClient.assets` so applet iframes can use it too — same routing as `assetInfo` (host message → main renderer).

### 4. `<wal-embed>` element

File: [libs/elements/src/elements/wal-embed.ts](../libs/elements/src/elements/wal-embed.ts)

Mirror Path 1's UI but drive it from the host lookup instead of explicit props:

- New `AssetStatus` variant `{ type: 'tool not activated'; appletHash; groupDnaHash; toolName; toolIcon }`.
- In `firstUpdated()`, when `assetInfo` returns `undefined`:
  ```ts
  const unjoined = await window.__WEAVE_API__.assets.unactivatedAppletForWal?.(wal);
  this.assetStatus = unjoined
    ? { type: 'tool not activated', ...unjoined }
    : { type: 'not found' };
  ```
- `renderContent()` for the new state shows the Tool icon (when present), the message *"This asset cannot be loaded until **\<toolName\>** is activated."*, and an Activate button that dispatches `open-tool-info` (`bubbles: true, composed: true`) with `{ kind: 'activate-applet', appletHash, groupDnaHash }`. Same event shape the sidebar already emits.

No new properties on the element — every embed everywhere benefits automatically once the host method is wired up.

### 5. Listener parity

Confirm the dashboard's group container catches `open-tool-info` (same point as in Path 1) — add the listener if missing.

For applet iframes that contain `wal-embed`, the event bubbles inside the iframe and doesn't reach the host. We bridge it: in the applet host code, forward `open-tool-info` from the iframe via `postMessage` and translate it into the same renderer-side dialog open. (Existing iframe→host messaging conventions in `iframes/applet-iframe/src/index.ts` are the model.)

### 6. Tests

`we-rust-utils`:
- Hash a known happ with several modifier combinations and assert against fixtures.
- Tryorama: install the happ, compare conductor-reported DNA hashes against the offline ones — must match.

Moss renderer:
- Unit test for `unactivatedAppletByDnaHash` builder: feed a fixture group with two unjoined applets, assert the index resolves each applet's cell DnaHashes.
- Integration (tryorama): two-agent group, agent A installs Tool X and creates a wal-embed pointing into Tool X. Agent B joins the group without activating Tool X. Open the group home → assert the friendly UI (Tool name, Activate button) appears. Click Activate → assert `installApplet` is called and the embed re-renders to the asset.

`libs/elements`:
- Same wal-embed tests as Path 1, but driven by the host lookup mock rather than explicit hints.

## Performance & resource concerns

- DNA hashing is fast for typical zome sizes (tens of ms per role on modern hardware), but a group can have many applets. Compute lazily on first WAL lookup and cache by `(sha256_happ, network_seed, propertiesHash)` so repeated lookups across embeds are O(1).
- `.happ` bundles for unjoined applets must be fetched if not already cached locally. This is a network operation — pipe through the existing `fetchAndStoreHapp` so it shares cache, retries, and progress UI with normal install.
- The renderer must not block the main thread: keep the hashing call async (NAPI off-thread).

## Risks

- **Properties shape mismatch.** `Applet.properties: Record<string, Uint8Array>` is per-role. The helper must apply each role's bytes via the same path Holochain uses at install (`RoleSettings::Provisioned { modifiers: Some { properties, .. } }`). If we apply them differently, hashes mismatch silently. Mitigate with the tryorama equivalence test in §6.
- **Compatibility with future Holochain DNA-hash changes.** If Holochain ever changes how it derives DNA hashes, the renderer needs a new `we-rust-utils` build that matches the new Holochain version. Pin to the same `holochain_types` version Moss bundles.
- **Cold-start cost** the first time a group is opened with many unjoined applets and their happs aren't on disk. Acceptable — same cost as activating them, just deferred until needed.

## Why this is more work than Path 1

- New native code path through NAPI, with its own version-coupling and CI surface.
- Renderer must manage `.happ` fetch-without-install for applets the user hasn't joined.
- Equivalence testing against the conductor is a real ongoing maintenance cost.

But the payoff is full generality: any WAL anywhere, no per-context plumbing, no schema bumps, retroactive coverage for tiles/URLs already in the wild.

## Relationship to Path 1

These aren't exclusive. Path 1 is a fast, targeted improvement; Path 2 is the universal solution. If both ship, the `wal-embed` element prefers explicit hints (Path 1) when present and falls back to the host lookup (Path 2) otherwise — Path 1's hint becomes a hot-path optimization for Path 2's index miss.
