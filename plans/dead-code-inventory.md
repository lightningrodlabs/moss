# Dead-code inventory — renderer cleanup

Companion to [ui-testing-and-cruft-cleanup.md](ui-testing-and-cruft-cleanup.md), Phase 3.

This is an **inventory for review, not a removal list**. Each item is a renderer
component with **zero imports anywhere** in `src/`, `iframes/`, `libs/`, `shared/`
(verified by import-path grep on 2026-05-16). For each: what it did, which design
era it belongs to, and what else would be affected by removing it.

Decision column is for you to fill in.

## Method

Orphan scan over every `*.ts` under `src/renderer/src/elements/`, looking for any
`import` referencing the file by path. Five files have no importer. Second-order
dead code (files imported *only* by a dead file) was then checked — none found;
every dependency of these five is also used by a live component.

---

## 1. `navigation/applets-sidebar.ts` — `<applets-sidebar>`

- **Size:** 117 lines
- **Last touched:** 2026-01-28 (an i18n sweep — not real use)
- **What it did:** Rendered a sidebar list of *all running applets across all
  groups*, de-duplicated by `ToolCompatibilityId`, each as an `applet-logo`. A
  global, group-agnostic tool list.
- **Design era:** Pre-`_new_design`. This is the "tools listed outside the group
  pane" model the cleanup plan exists to remove.
- **Removing it strands:** nothing. Its imports (`group-context`, `applet-logo`,
  `create-group-dialog`) are all used by live components.
- **Risk:** none — no live code path reaches it.
- **Decision:** _____

## 2. `navigation/group-applets-sidebar.ts` — `<group-applets-sidebar>`

- **Size:** 374 lines
- **Last touched:** 2026-02-10 (foyer-notifications fix — incidental, not use)
- **What it did:** Self-described "Sidebar for the applet instances of a group" —
  rendered a group's installed tools as a vertical strip of
  `applet-topbar-button`s, plus a home button. The per-group tool strip from the
  old layout.
- **Design era:** Pre-`_new_design`. Directly the old group-tools-listing UI;
  superseded by the tool list nested inside the group pane in the new design.
- **Removing it strands:** nothing. It is the only group-agnostic importer of
  `applet-topbar-button.js`, but that element is still imported by
  `group-applets-row.ts` (live, used by the creatables panels).
- **Risk:** none.
- **Decision:** _____

## 3. `_new_design/moss-input.ts` — `<moss-input>`

- **Size:** 30 lines
- **Last touched:** 2026-01-23
- **What it did:** A thin wrapper around `<sl-input>` with a hardcoded "My group
  is called" label. Stub — its `@element` JSDoc tag even still reads
  `create-group-dialog`, suggesting it was copy-pasted and never finished.
- **Design era:** *New* design (lives in `_new_design/`), but never wired up.
  Note: the CSS class `.moss-input` is used widely — that is unrelated to this
  custom element.
- **Removing it strands:** nothing.
- **Risk:** none functionally. Judgment call: this is unfinished *new* code, not
  legacy cruft — it may be a placeholder someone intends to build out. Out of the
  strict Phase-3 scope; flagged here only because the orphan scan caught it.
- **Decision:** _____

## 4. `pocket/draggable-pocket.ts` — `<draggable-pocket>`

- **Size:** 181 lines
- **Last touched:** 2025-02-28, commit message "palette wip"
- **What it did:** A draggable floating pocket/palette widget — a movable overlay
  for browsing WALs and search results, with a `Pocket`/`Palette` sidecar toggle.
- **Design era:** An abandoned pocket-UI experiment. The live pocket is
  `pocket/pocket.ts` (used by `asset-view.ts` and `main-dashboard.ts`).
- **Removing it strands:** nothing — `wal-element`, `wal-created-element`,
  `pocket-search` are all shared with the live `pocket.ts` and the creatables.
- **Risk:** none. Not group-tools-listing cruft — unrelated abandoned spike.
  Outside strict Phase-3 scope; listed for completeness.
- **Decision:** _____

## 5. `pocket/overlay-pocket.ts` — `<overlay-pocket>`

- **Size:** 370 lines
- **Last touched:** 2026-01-28 (i18n sweep — not real use)
- **What it did:** A full-screen overlay variant of the pocket — WAL search,
  recently-created list, headless WeaveClient wiring, delete actions.
- **Design era:** Same abandoned pocket-UI experiment as #4. Superseded by
  `pocket/pocket.ts`.
- **Removing it strands:** nothing (same shared deps as #4).
- **Risk:** none. Outside strict Phase-3 scope; listed for completeness.
- **Decision:** _____

---

## 6. The `personal-view-sidebar` subtree — dead via a kill-switched render branch

This is **not** an orphan-file finding — every file here has live `import`
statements, so an import-graph scan calls them all "LIVE". They are dead by
**render path**: the only place the tree is mounted is gated by a hardcoded
`false`. Verified 2026-05-17 by tracing actual `<tag>` render sites, not imports.

**The kill-switch:** [main-dashboard.ts:1705](../src/renderer/src/elements/main-dashboard.ts#L1705)

```ts
${false && this._dashboardState.value.viewType === 'personal'
  ? html` … <personal-view-sidebar> … `   // the old top-bar
  : html``}
```

The `false &&` makes the whole top-bar block (lines 1704–1758) unreachable.
That block is the *only* render site of `<personal-view-sidebar>`.

**The subtree** (623 lines, all four DEAD):

| File | Lines | `<tag>` render sites | Verdict |
|------|-------|----------------------|---------|
| `navigation/personal-view-sidebar.ts` | 284 | only the `false &&` block | dead |
| `navigation/tool-personal-bar-button.ts` | 81 | `<tool-personal-bar-button>` rendered nowhere | dead |
| `navigation/applet-topbar-button.ts` | 141 | `<applet-topbar-button>` rendered nowhere | dead |
| `navigation/topbar-button.ts` | 117 | `<topbar-button>` rendered only by the two dead files above | dead |

The chain that makes them *look* live is **stale side-effect imports**:
`personal-view-sidebar.ts` still `import`s `tool-personal-bar-button.js` and
`topbar-button.js` but its `render()` uses neither. Likewise `group-applets-row.ts`
and `group-applets-creatables.ts` (both LIVE, via the creatables panels) carry a
stale `import './applet-topbar-button.js'` / `topbar-button.js` they never render.

**Functionality check — nothing is lost.** `personal-view-sidebar.ts` contains the
"Experimental features" menu (clover button → cross-group tool navigation, "All
streams", "Artefacts graph"). That cross-group navigation is **already preserved**:
`personal-views/welcome-view/welcome-view.ts` (LIVE — the current home view) has a
near-verbatim copy of `renderExperimentalMenu` / `renderToolMenuItems`. The
welcome-view copy is what users see today. `personal-view-sidebar`'s copy is the
superseded original. No code needs to be parked in a `self/utils/` — the useful
part was already carried forward.

**Removal requires** (one commit):
1. Delete the four files above.
2. Delete the `false &&` top-bar block in `main-dashboard.ts` (1704–1758) + its
   `import './navigation/personal-view-sidebar.js'`.
3. Drop the stale `applet-topbar-button.js` / `topbar-button.js` side-effect
   imports from `group-applets-row.ts` and `group-applets-creatables.ts`.
4. `git grep` confirms `<topbar-button>` / `<applet-topbar-button>` /
   `<tool-personal-bar-button>` / `<personal-view-sidebar>` have zero remaining
   render sites; then `yarn typecheck && yarn test:e2e`.

- **Risk:** none — no live render path; cross-group nav preserved in welcome-view.
- **Decision:** _____

---

## Summary

| # | Item | Era | Risk | Status |
|---|------|-----|------|--------|
| 1 | `applets-sidebar.ts` | pre-`_new_design` | none | **removed** (5967454d) |
| 2 | `group-applets-sidebar.ts` | pre-`_new_design` | none | **removed** (5967454d) |
| 3 | `_new_design/moss-input.ts` | new (unfinished stub) | none | **removed** (4808f11f) |
| 4 | `pocket/draggable-pocket.ts` | abandoned spike | none | kept (out of scope) |
| 5 | `pocket/overlay-pocket.ts` | abandoned spike | none | kept (out of scope) |
| 6 | `personal-view-sidebar` subtree (4 files) | pre-`_new_design` top-bar | none | awaiting decision |

Item 6 is the real Phase-3 prize: the actual pre-`_new_design` top-bar layout,
kill-switched with `false &&` and never deleted. Items 4–5 are unrelated orphans
left for other stories.
