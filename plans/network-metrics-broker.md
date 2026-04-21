# Plan: Moss-Brokered Network Metrics with Refcounted Polling

## Problem Statement

Multiple consumers (the debugging panel today; tools tomorrow) all want `dumpNetworkMetrics` data:

- Each tool that wants this data makes its own `AppClient.dumpNetworkMetrics()` call via its own app WebSocket.
- Each of those calls, inside the conductor, runs a **serial** per-DNA loop over the app's cells ([`conductor.rs:2509-2567`](../../holochain/crates/holochain/src/conductor/conductor.rs)).
- Useful post-processing (transport-key → AgentPubKey → profile) is duplicated per tool.
- Nothing throttles or coordinates polling cadence across tools.

The debugging panel already does this work, duplicating per-app data and translations that Moss already has in `GroupStore` (profiles, `spaceIdToDnaHash`, `kitsuneAgentIdToAgentPubKey`, `extractTransportKeyFromUrl`).

## Goals

1. Move `dumpNetworkMetrics` + `dumpNetworkStats` polling from the debugging panel into a central service owned by `MossStore`.
2. Expose it via `@theweave/api` as a first-class request surface so tools (and the debugging panel) consume it uniformly.
3. Only poll while at least one consumer has an active subscription (refcounted; polling stops when the count drops to zero). Tool subscriptions are scoped per-applet-per-group — a single iframe in a single group is the subscription unit.
4. Deliver the full raw `DumpNetworkMetricsResponse` shape for backward compatibility — filtered to the requesting applet-in-group's DNAs.
5. Add a simplified, derived API surface for the common case: "who are the currently-connected peers in my DNAs, with their profiles, and are they directly connected?"

## Non-Goals

- Replacing or deprecating direct `AppClient.dumpNetworkMetrics()` calls. Tools that want admin-level or ad-hoc one-off data can still call their own `AppClient` directly.
- Exposing DHT summary data to tools by default. The simplified API works with `include_dht_summary: false`; the full surface can request it.
- Persisting metrics history. This plan covers live data only; tiered history (as in the memory charts) stays local to the debugging panel if needed.

## Current Code Map

### Where polling lives today

[`src/renderer/src/elements/debugging-panel/debugging-panel.ts`](../src/renderer/src/elements/debugging-panel/debugging-panel.ts):

- `firstUpdated()` (line ~370) starts `safeSetInterval` calling `pollNetworkStats()` every 2s.
- `pollNetworkStats()` (line ~1011):
  - Calls `adminWebsocket.dumpNetworkStats()` → fans out `network-stats-update` to each group's applets via `groupStore.emitToGroupApplets`.
  - For each `appId` in `_appsToPollNetworkStats`, calls `client.dumpNetworkStats()` and `client.dumpNetworkMetrics({ include_dht_summary: true })`.
  - Calls `buildTransportToAgentMap(appId, networkMetrics)` — fetches `agentInfo({ dna_hashes })`, decodes each entry's `agent` + `url`, extracts transport key from URL, maps `transportKey → AgentPubKeyB64`.
- `disconnectedCallback()` cancels the interval.

### Reusable helpers already in the debugging panel

- `spaceIdToDnaHash(spaceId)` — line 908.
- `kitsuneAgentIdToAgentPubKey(kitsuneAgentId)` — line 918.
- `extractTransportKeyFromUrl(peerUrl)` — line 929.
- `decodeUrlSafeBase64` — just above.
- `transformMetrics(metrics)` — line 187: decodes hashes, formats arcs, sorts `peer_meta`.

These move into a shared utility module (see Phase 1).

### Existing `network-stats-update` pipe

Already wired end-to-end:
- [`src/renderer/src/groups/group-store.ts:1663`](../src/renderer/src/groups/group-store.ts#L1663) `emitToGroupApplets()`.
- [`src/renderer/src/moss-store.ts:1882`](../src/renderer/src/moss-store.ts#L1882) `emitParentToAppletMessage()` — posts to main-window iframes and WAL windows via `window.electronAPI.parentToAppletMessage`.
- [`libs/api/src/types.ts:298`](../libs/api/src/types.ts#L298) `ParentToAppletMessage` variant `'network-stats-update'`.
- [`iframes/applet-iframe/src/index.ts:660`](../iframes/applet-iframe/src/index.ts#L660) re-dispatches to `window` as `CustomEvent`.
- [`libs/api/src/api.ts:359`](../libs/api/src/api.ts#L359) `onNetworkStatsUpdate` callback API.

The network-metrics pipe will be modelled on this, plus subscribe/unsubscribe messages (like `subscribe-to-asset-store`).

### Profiles / agent resolution

Each group's `profilesStore` already exposes `agentsWithProfile` and per-agent lookup ([`group-store.ts:252`](../src/renderer/src/groups/group-store.ts#L252), `agentsProfiles()` at line 909). The service uses these directly rather than duplicating profile fetches.

## Design

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     MossStore (renderer)                         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           NetworkMetricsService (new)                     │   │
│  │                                                           │   │
│  │  - subscribers: Map<SubscriberKey, SubscriberSpec>       │   │
│  │  - latest: Map<InstalledAppId, AppNetworkSnapshot>       │   │
│  │  - pollHandle: SafeIntervalHandle | undefined            │   │
│  │                                                           │   │
│  │  subscribe(key, spec) → start poll if first subscriber   │   │
│  │  unsubscribe(key)     → stop poll if last subscriber     │   │
│  │  pollOnce()                                              │   │
│  │  snapshotFor(appId)   → AppNetworkSnapshot | undefined   │   │
│  │  peersFor(appId)      → ConnectedPeer[] (derived)        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│      ┌───────────────────────┼──────────────────────────┐       │
│      │                       │                          │       │
│      ▼                       ▼                          ▼       │
│  Admin WS              per-app AppClient          GroupStore     │
│  dumpNetworkStats     dumpNetworkMetrics         profilesStore   │
│  (once per tick)      (parallel per app)         (lookup only)   │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴──────────────────┐
            ▼                                    ▼
    parent→applet message                   debugging panel
   'network-metrics-update'            (reads from service directly)
   'network-stats-update' (kept)
            │
            ▼
    WeaveClient
    - onNetworkMetricsUpdate(cb)
    - subscribeToNetworkMetrics(opts)
    - unsubscribeFromNetworkMetrics()
    - getConnectedPeers() (derived simplified view)
```

### Key design decisions

**Refcounted poll lifecycle.** The service tracks subscribers keyed by `SubscriberKey = { kind: 'tool', appletId: AppletId } | { kind: 'internal', id: string }`. An `AppletId` is the base64 applet hash, which already uniquely identifies an applet-*in-a-group*: the same tool installed in two groups has two different applet hashes (each is a distinct `InstalledAppId` in the conductor — see [`shared/utils/src/utils.ts:63`](../shared/utils/src/utils.ts#L63) `appIdFromAppletHash`). So "per applet per group" is encoded naturally in the key. The debugging panel subscribes with `kind: 'internal', id: 'debugging-panel'`; each tool subscribes via `subscribe-to-network-metrics` through the iframe bridge (the iframe's `IframeKind` carries `appletHash` and `groupHash`; the bridge uses `appletHash` as the key and remembers `groupHash` for profile resolution). `subscribe()` starts the poll on first subscriber; `unsubscribe()` stops it on last.

**Per-subscriber options.** Different subscribers may want different things. The service stores `SubscriberSpec { intervalMs?, includeDhtSummary? }` and reconciles them: poll interval = `max(min(all subscribers' intervalMs), 1000)` (hard cap at 1s — a rogue tool cannot set a shorter interval), DHT summary = `any(includeDhtSummary)`. The debugging panel keeps `intervalMs: 2000, includeDhtSummary: true`; tools default to `intervalMs: 5000, includeDhtSummary: false`.

**Single admin call + filtered fan-out.** On each tick:
1. One `adminWebsocket.dumpNetworkStats()` — cheap, returns all transport stats + `blocked_message_counts`.
2. One `adminWebsocket.dumpNetworkMetrics({ include_dht_summary })` — this uses the admin path that runs `join_all` across all spaces in parallel (see [`actor.rs:2335`](../../holochain/crates/holochain_p2p/src/spawn/actor.rs#L2335)).
3. For each subscribed app, the service computes the set of DNA hashes for that app from the cached app→DNA map (built once via `getAppClient(appId).appInfo()` on first subscribe) and filters the admin response down to that app's slice before delivering.

**Why admin path, not per-app?** The app path (`dump_network_metrics_for_app`) runs a serial `for` loop across the app's DNAs inside the conductor ([`conductor.rs:2543`](../../holochain/crates/holochain/src/conductor/conductor.rs#L2543)). The admin path uses `join_all`. For many apps, the admin path is faster and collapses N WebSocket roundtrips into one. The result is shape-identical (`HashMap<DnaHash, Kitsune2NetworkMetrics>` — a JS `Record<DnaHashB64, NetworkMetrics>`), so filtering-then-delivery preserves the contract.

**Backward-compatible response shape.** The per-app slice is exactly what `appClient.dumpNetworkMetrics(...)` would have returned. Tools that already call that directly can switch to the brokered API with no shape changes.

**Derived simplified view computed once in Moss.** The service materialises the transport-to-agent-to-profile join in one place and caches per-app results.

### Shared utility module

Create [`src/renderer/src/processes/network-metrics/helpers.ts`](../src/renderer/src/processes/network-metrics/helpers.ts):

```typescript
export function spaceIdToDnaHash(spaceId: string): DnaHash { /* moved from debugging-panel.ts:908 */ }
export function kitsuneAgentIdToAgentPubKey(kitsuneAgentId: string): AgentPubKey { /* line 918 */ }
export function extractTransportKeyFromUrl(peerUrl: string): string | null { /* line 929 */ }
export function decodeUrlSafeBase64(s: string): Uint8Array { /* line ~890 */ }
export function transformMetrics(m: DumpNetworkMetricsResponse): DumpNetworkMetricsResponse { /* line 187 */ }
```

The debugging panel imports these instead of defining them as methods.

### Service shape

[`src/renderer/src/processes/network-metrics/service.ts`](../src/renderer/src/processes/network-metrics/service.ts):

```typescript
export interface AppNetworkSnapshot {
  transportStats: TransportStats;
  networkMetrics: DumpNetworkMetricsResponse;     // filtered to this app's DNAs
  blockedCounts: BlockedMessageCounts;             // filtered to this app's DNAs
  transportToAgent: Map<string, AgentPubKeyB64>;  // for this app only
  fetchedAt: number;
}

export interface ConnectedPeer {
  agentPubKey: AgentPubKeyB64;
  dnaHash: DnaHashB64;
  transportKey: string;
  peerUrl: string;
  /**
   * Reflects `TransportConnectionStats.is_direct` from the transport stats —
   * true if this connection is on a direct peer-to-peer path, false if
   * traffic is still going through a relay/signal intermediary. The field
   * is transport-agnostic:
   *   - iroh: selected path is IP-based (not going through an iroh relay)
   *   - tx5:  WebRTC connection established (not going through signal server)
   *   - reticulum: always true
   * Sourced directly from:
   *   transportStats.connections.find(c => c.pub_key === transportKey).is_direct
   * (see kitsune2 api/transport.rs `TransportConnectionStats.is_direct`).
   */
  isDirect: boolean;
  lastGossipAt?: number;
  storageArc?: [number, number];
  profile?: MaybeProfile;                         // resolved via GroupStore.profilesStore when available
}

export interface SubscriberSpec {
  intervalMs?: number;           // default 5000
  includeDhtSummary?: boolean;   // default false
}

export class NetworkMetricsService {
  constructor(private mossStore: MossStore) {}

  subscribe(key: SubscriberKey, spec: SubscriberSpec): void;
  unsubscribe(key: SubscriberKey): void;

  snapshotFor(appId: InstalledAppId): AppNetworkSnapshot | undefined;
  peersFor(appId: InstalledAppId): ConnectedPeer[];

  // Fired after each successful poll, once per app that has subscribers.
  onUpdate(cb: (appId: InstalledAppId, snapshot: AppNetworkSnapshot) => void): UnsubscribeFn;
}
```

Scope note: `snapshotFor(appId)` / `peersFor(appId)` take the `InstalledAppId` derived from the applet hash via `appIdFromAppletHash(appletHash)`. One iframe → one applet hash → one `appId` → one slice of network metrics. The applet hash itself uniquely identifies the applet instance within its group, so no explicit `groupHash` parameter is needed on these methods.

### New API surface

Add to [`libs/api/src/types.ts`](../libs/api/src/types.ts) `AppletToParentRequest`:

```typescript
| { type: 'subscribe-to-network-metrics'; opts?: { intervalMs?: number; includeDhtSummary?: boolean } }
| { type: 'unsubscribe-from-network-metrics' }
| { type: 'get-connected-peers' }  // one-shot convenience, reads latest snapshot
```

Add to `ParentToAppletMessage`:

```typescript
| {
    type: 'network-metrics-update';
    payload: {
      // The raw, backward-compatible shape (filtered to this app's DNAs):
      networkMetrics: DumpNetworkMetricsResponse;
      // Simplified derived view:
      connectedPeers: ConnectedPeer[];
    };
  }
```

Add to [`libs/api/src/api.ts`](../libs/api/src/api.ts) `WeaveServices`:

```typescript
onNetworkMetricsUpdate: (cb: (payload: NetworkMetricsUpdate) => any) => UnsubscribeFunction;
subscribeToNetworkMetrics: (opts?: { intervalMs?: number; includeDhtSummary?: boolean }) => Promise<void>;
unsubscribeFromNetworkMetrics: () => Promise<void>;
getConnectedPeers: () => Promise<ConnectedPeer[]>;
```

Validation schema entries go in [`src/renderer/src/validationSchemas.ts`](../src/renderer/src/validationSchemas.ts) alongside the existing `subscribe-to-asset-store` entries.

### Handler wiring

In [`applet-host.ts`](../src/renderer/src/applets/applet-host.ts) `handleAppletIframeMessage`:

```typescript
case 'subscribe-to-network-metrics': {
  if (source.type === 'cross-group') throw new Error('...');
  const appId = appIdFromAppletHash(source.appletHash);
  mossStore.networkMetrics.subscribe(
    { kind: 'tool', appletId: encodeHashToBase64(source.appletHash) },
    message.opts ?? {},
  );
  return;
}
case 'unsubscribe-from-network-metrics': { /* symmetric */ }
case 'get-connected-peers': {
  const appId = appIdFromAppletHash(source.appletHash);
  return mossStore.networkMetrics.peersFor(appId);
}
```

The service's internal `onUpdate` listener (registered in `MossStore` init) fans out via `emitParentToAppletMessage` to whichever applets currently have a subscriber for the corresponding app.

## Implementation Phases

### Phase 1 — Extract helpers, no behaviour change

1. Create `src/renderer/src/processes/network-metrics/helpers.ts` with the five pure functions listed above (no class methods, no `this`).
2. Replace the inline definitions in [`debugging-panel.ts`](../src/renderer/src/elements/debugging-panel/debugging-panel.ts) with imports.
3. Delete the now-unused private method versions.

**Test**: `yarn typecheck:web` passes; the debugging panel still renders and polls.

### Phase 2 — Build the service behind a feature flag

1. Add `NetworkMetricsService` to `src/renderer/src/processes/network-metrics/service.ts`.
2. Instantiate on `MossStore` as `this.networkMetrics = new NetworkMetricsService(this)` in the constructor. Do not auto-start polling.
3. Unit tests for:
   - `subscribe()` starts the interval; `unsubscribe()` stops it when the last subscriber leaves.
   - Adding a second subscriber with a shorter `intervalMs` reconciles (service polls at the shorter interval).
   - `snapshotFor(appId)` returns undefined when no poll has run; returns the filtered slice after a poll.
   - `peersFor(appId)` resolves profiles via a mocked `groupStore.profilesStore`.

The service is in place but no caller uses it yet.

### Phase 3 — Migrate the debugging panel to the service

1. In `debugging-panel.ts`:
   - Replace `_refreshInterval` + `pollNetworkStats()` with `mossStore.networkMetrics.subscribe({ kind: 'internal', id: 'debugging-panel' }, { intervalMs: 2000, includeDhtSummary: true })`.
   - Subscribe to `networkMetrics.onUpdate` and write the same `_networkStats` / `_adminNetworkStats` / `_transportToAgentMap` state from snapshots.
   - `disconnectedCallback()` calls `unsubscribe(...)`.
2. Keep `network-stats-update` emission (the current cross-tool broadcast) but move it *into* the service: after each poll, the service calls `emitToGroupApplets({ type: 'network-stats-update', payload: adminStats.transport_stats })` exactly as today. This is the one place all applets already listen, and it becomes free-rider data once the service is running for any reason.

**Test**: open the debugging panel, verify panel renders same data. Close it; verify polling stops (add a debug `console.log` in `pollOnce`).

### Phase 4 — Wire the tool-facing API

1. Add the three new `AppletToParentRequest` variants + validation schema entries.
2. Add the `network-metrics-update` `ParentToAppletMessage` variant.
3. Add handler cases in `applet-host.ts`.
4. Add the iframe-side plumbing in [`iframes/applet-iframe/src/index.ts`](../iframes/applet-iframe/src/index.ts) — `window`-event dispatch and unsubscribe plumbing, following the `network-stats-update` pattern.
5. Add the four new methods to `WeaveServices` in `libs/api/src/api.ts` + the `WeaveClient` forwarding.
6. Add `ConnectedPeer` and `NetworkMetricsUpdate` types to `libs/api/src/types.ts`.
7. Export from `libs/api/src/index.ts`.

**Test**:
- Tryorama test that installs a dev applet, has it call `subscribeToNetworkMetrics`, and verifies `onNetworkMetricsUpdate` callback fires with a filtered payload containing only that applet's DNAs.
- Verify `unsubscribeFromNetworkMetrics` stops delivery and (when it's the last subscriber and debugging panel isn't open) stops the interval.
- Manual test in `yarn applet-dev-example`: temporarily wire the example applet to log `getConnectedPeers()` output.

### Phase 5 — Deprecate duplicated code in the debugging panel

Once Phase 3 is stable:
- Remove `buildTransportToAgentMap` from the debugging panel (now in the service).
- Remove `pollNetworkStats` body (now a thin subscribe call).
- Keep the rendering methods untouched — they read from `_networkStats` and `_transportToAgentMap` which are now populated by the service's `onUpdate` callback.

## Risks and Mitigations

- **Admin-path filtering misses app-specific data.** The admin `dumpNetworkMetrics` returns metrics for all spaces; we filter to the app's DNAs. The filtering is correct *only* if an app's DNAs are deterministic from `appInfo`. They are ([`conductor.rs:2514-2533`](../../holochain/crates/holochain/src/conductor/conductor.rs#L2514) uses the same `role_assignments` walk we'd do from `appInfo`). Add a sanity test that verifies the admin-filtered slice equals the per-app response for a fresh conductor.

- **Subscriber leak / invisible-iframe polling.** The product requirement is that polling should only happen while *some portion of the applet's UI* is actually active. If a tool subscribes and never unsubscribes (iframe crashes, iframe gets hidden without cleanup), polling continues forever — or worse, keeps polling for an iframe the user isn't even looking at. Mitigations, in order:
  1. Auto-unsubscribe on iframe unregister. `AppletHost`/iframe registry in `iframeStore` already knows when iframes are unregistered — hook into that to drop tool subscribers for any iframe whose `appletHash` no longer has any registered iframes.
  2. Tools are expected to unsubscribe in their teardown (e.g. on `onBeforeUnload`), and the `WeaveClient` docs should say so.
  3. (Future, optional) We could auto-pause subscriptions for hidden iframes using `document.visibilityState` bridged via the iframe, but this is a v2 concern — the unregister hook covers the common cases (panel closed, tool uninstalled, app closed).

- **Polling cadence churn.** If a 5s subscriber joins while the 2s panel is open, then the panel closes, the interval needs to reconcile upward. The reconciliation (recompute `min` on every subscribe/unsubscribe and restart the interval) is cheap — one `safeSetInterval` cancel + create.

- **Profile resolution race.** A peer appearing in metrics may not yet have a profile in `profilesStore`. Return `profile: undefined` in that case; consumers already handle the null case (the debugging panel's current rendering does).

- **DHT summary size.** `include_dht_summary: true` returns large arrays per space. The debugging panel needs it; tools almost never will. Default to `false` and only flip the flag on the admin call when *some* subscriber asked for it — done naturally by the reconciliation logic.

## Resolved Decisions

1. **Scope**: per-applet-per-group. An applet hash uniquely identifies an applet instance within a group, so it's the natural subscription key; the same tool installed in two groups produces two independent subscriptions. `getConnectedPeers()` returns peers in the DNAs of the specific applet-in-group making the call — not a cross-group roll-up.
2. **Callback vs reactive store**: the initial `WeaveClient` surface is callback-based — `onNetworkMetricsUpdate(cb)` mirrors the existing `onPeerStatusUpdate` / `onNetworkStatsUpdate` APIs for consistency. A Svelte-readable reactive store (like `assets.assetStore`) could be added later in an additive fashion if there's demand — out of scope here.
3. **Rate-limit cap**: the reconciled polling interval is hard-capped at **1000ms minimum**. A rogue tool requesting `intervalMs: 100` is clamped to 1000ms. Applied in `reconcileInterval()` inside the service.

## Success Criteria

- Debugging panel renders the same data it does today, driven through the service.
- Closing the debugging panel with no tool subscribers stops the poll loop (verify via instrumentation).
- A dev applet can call `subscribeToNetworkMetrics()` and receives `onNetworkMetricsUpdate` callbacks with a response shape equal to what `appClient.dumpNetworkMetrics()` would return, filtered to its DNAs.
- `getConnectedPeers()` returns agents resolved through `profilesStore`, not raw transport keys.
- No regression in CI tests.
