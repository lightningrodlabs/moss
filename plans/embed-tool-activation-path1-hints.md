# Embed activation UX — Path 1: per-context source-applet hints

## Goal

When a `<wal-embed>` cannot load its asset because the owning Tool isn't activated in the local conductor, show a friendly message ("This asset cannot be loaded until **\<Tool Name\>** is activated") plus an Activate button that opens the existing `tool-info-dialog` activate flow.

Path 1 sidesteps the "we can't map a bare DnaHash to an unjoined applet" problem by having every embedding context pass an explicit `srcAppletHash` (+ `srcGroupDnaHash`) hint to `<wal-embed>`. The library element uses the hint only as a fallback — when `assetInfo()` succeeds the hint is ignored.

Scope is intentionally narrow: cover the embed contexts we control (dashboard wal-embed tiles, WAL URL strings rendered in markdown / passed between applets). Legacy embeds without a hint keep showing the existing "Asset not found." message.

## Constraints

- `wal-embed` lives in `libs/elements` and is consumed by applets via `@theweave/elements`. It must stay framework-agnostic — no direct imports from `moss-store` / `group-store`.
- The activate flow already exists ([src/renderer/src/app/dialogs/tool-info-dialog.ts:271-281](../src/renderer/src/app/dialogs/tool-info-dialog.ts#L271-L281)) and is opened via an `open-tool-info` `CustomEvent` with `detail: { kind: 'activate-applet', appletHash, groupDnaHash }`. We reuse this exactly.
- Persisted data changes (dashboard tile schema, WAL URL grammar) must be backwards-compatible: old entries deserialize and render — they just don't get the new UX.

## Pieces of work

### 1. `<wal-embed>` element — new state + props

File: [libs/elements/src/elements/wal-embed.ts](../libs/elements/src/elements/wal-embed.ts)

- Add two optional properties:
  - `srcAppletHash?: string` — base64-encoded EntryHash of the originating applet.
  - `srcGroupDnaHash?: string` — base64-encoded DnaHash of the group the activate flow should target.
- Add a new `AssetStatus` variant:
  ```ts
  | { type: 'tool not activated'; appletHash: string; groupDnaHash: string }
  ```
- In `firstUpdated()`, when `assetInfo` returns `undefined` **and** both hint props are set, set status to `'tool not activated'` instead of `'not found'`.
- Extend `renderContent()`:
  - For `'tool not activated'`, render: an icon + the message *"This asset cannot be loaded until this Tool is activated."* + an **Activate** button styled like `moss-mini-button`. (We deliberately don't fetch the Tool name in the library element — the dialog shown after click already displays it. Optionally accept a `srcToolName?: string` prop for the message body when the caller has it cheaply.)
  - The button dispatches a `CustomEvent('open-tool-info', { detail: { kind: 'activate-applet', appletHash, groupDnaHash }, bubbles: true, composed: true })`. Same shape the sidebar uses, so any existing listener handles it.
- For `'not found'` keep the current "Asset not found." text — it now only fires when we genuinely don't have a hint, matching today's behavior.
- New behavior must not break applet consumers of `wal-embed`: the new props are optional, the new state is only reachable when they're provided. No exported type changes.

Tests (Vitest, in `libs/elements`):
- Renders activate UI when hints are present and the mock host's `assetInfo` resolves `undefined`.
- Renders "Asset not found." when hints are absent and `assetInfo` resolves `undefined`.
- Click on Activate dispatches a composed/bubbling `open-tool-info` event with the expected detail.

### 2. Listener for the `open-tool-info` event in dashboard contexts

The sidebar already wires this event to opening `tool-info-dialog`. Verify the dashboard's ancestor (group container) catches it — if not, add a `@open-tool-info` listener on the relevant ancestor that forwards to the existing dialog opener. No new dialog code.

Files to verify:
- [src/renderer/src/app/navigation/group-area-sidebar.ts](../src/renderer/src/app/navigation/group-area-sidebar.ts) — emitter today.
- The component owning `<group-dashboard>` — the listener target. Add an `@open-tool-info=${this._onOpenToolInfo}` handler if missing.

### 3. Dashboard wal-embed tile — capture & pass the hint

#### a) Schema bump

File: [shared/group-client/src/types.ts](../shared/group-client/src/types.ts)

- Extend the `'wal-embed'` variant:
  ```ts
  | { kind: 'wal-embed'; wal: string; srcAppletHash?: string; srcGroupDnaHash?: string }
  ```
- Bump `GROUP_DASHBOARD_SCHEMA_VERSION` from 1 → 2.
- In `GroupClient.getGroupDashboard` migration code, treat absent fields as `undefined` (no rewrite needed — purely additive).

The integrity zome stores the entry opaquely (JSON or msgpack of `GroupDashboard`), so the on-chain shape is unchanged in any breaking sense. No coordinator/integrity zome Rust changes needed if the entry is stored as serialized bytes.

#### b) Tile creation captures hints

Where a `'wal-embed'` tile is created from a currently-open WAL (palette / drop-from-asset flow), the caller already has the `AssetLocationAndInfo` (which includes `appletHash`) and the current `groupDnaHash`. Persist both alongside `wal` in the new tile entry.

Files to touch (audit during implementation — at minimum the dashboard editor):
- [src/renderer/src/groups/elements/group-dashboard.ts](../src/renderer/src/groups/elements/group-dashboard.ts) — tile-add code paths.
- Any palette / drag-source code that builds `{ kind: 'wal-embed', wal }`.

#### c) Tile rendering forwards hints

File: [src/renderer/src/groups/elements/group-dashboard.ts:1061-1099](../src/renderer/src/groups/elements/group-dashboard.ts#L1061-L1099)

```ts
case 'wal-embed':
  return html`<wal-embed
    .src=${tile.wal}
    .srcAppletHash=${tile.srcAppletHash}
    .srcGroupDnaHash=${tile.srcGroupDnaHash}
    bare
    style="display:block; height:100%; width:100%;"
  ></wal-embed>`;
```

### 4. WAL URL hint grammar (markdown + applet-to-applet embeds)

For embeds that come from a stringified WAL URL (markdown rendered in chat / tiles / applet UIs, deeplinks, `WeaveClient.openWal`-style flows), encode the hint inline so the URL is self-contained.

Files: [libs/api/src/util.ts](../libs/api/src/util.ts) (or wherever `weaveUrlFromWal` / `weaveUrlToLocation` live).

- Extend `weaveUrlFromWal(wal, opts?)` to accept `{ srcAppletHash?: EntryHash; srcGroupDnaHash?: DnaHash }` and append `&srcAppletHash=<b64>&srcGroupDnaHash=<b64>` query params when provided.
- Extend `weaveUrlToLocation` to parse those params and return them on the location (e.g. as a separate `hints` field), so callers can opt-in without breaking existing `'asset'` location consumers.
- Callers that already know the source (e.g. "copy WAL URL" buttons in asset chrome, markdown auto-link generators) start producing hint-bearing URLs. Existing URLs without hints keep working.
- `wal-embed.firstUpdated()` reads these hints from the parsed location and uses them as the same `srcAppletHash` / `srcGroupDnaHash` fallback (the explicit Lit props win if both are set).

### 5. Documentation

Touch [libs/api/README.md](../libs/api/README.md) and the dashboard tile docs (if any) to explain the new optional hints and that they enable the friendly Activate-this-Tool UX.

## Backwards compatibility

| Scenario                                                        | Behavior after change                                     |
|-----------------------------------------------------------------|-----------------------------------------------------------|
| Existing dashboard tile (no `srcAppletHash`), Tool not active   | Shows current "Asset not found." (unchanged)              |
| New dashboard tile (with hint), Tool not active                 | Shows friendly message + Activate button                  |
| New dashboard tile, Tool active                                 | Renders normally (hints ignored)                          |
| Markdown WAL URL without hint, Tool not active                  | "Asset not found." (unchanged)                            |
| Markdown WAL URL with hint, Tool not active                     | Friendly message + Activate                               |
| Applet consumer of `<wal-embed>` not passing hints              | Identical to today                                        |

## Out of scope for this path

- Generic "given any bare WAL, find its Tool" lookup — that's Path 2.
- Reactivation UX for *disabled* (joined-but-turned-off) applets. Disabled applets' DNAs *are* in the conductor, so `assetInfo()` resolves and we never reach the not-activated branch. Handling them is a separate task: detect disabled cells inside `assetInfo` and surface a "re-enable" action.
- Migrating existing dashboard tiles to gain hints retroactively — would require a steward to re-add affected tiles, or a Path-2 fallback at render time.

## Rollout

1. Land schema bump (`shared/group-client/src/types.ts`) + tile creation/rendering changes behind no flag — additive, safe.
2. Land `wal-embed` element changes with tests.
3. Land WAL URL hint grammar in `@theweave/api`; cut a minor version of `@theweave/api`.
4. Update markdown/asset-share callers to emit hint-bearing URLs.

Each step is independently mergeable; the UX progressively improves as callers adopt hints.
