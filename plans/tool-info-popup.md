# Tool Info Popup (right-click → tool details, informational)

## Goal

Right-click a tool in the **group tools sidebar** → the same "tool details" dialog
that the Tool Library shows pops up *in place* over whatever is currently visible
(no navigation away). The dialog is **informational only** — install buttons are
removed.

## Scope for v1

- Only one right-click site: the group tools sidebar
  ([src/renderer/src/elements/navigation/group-applets-row.ts:50-105](src/renderer/src/elements/navigation/group-applets-row.ts#L50-L105)).
- Other potential sites (personal sidebar, topbar, group home grid, group settings,
  tool library grid) are deliberately deferred — several of them live in pre-`_new_design`
  code paths that are candidates for cleanup. Wiring right-click into doomed
  components now is wasted work; revisit per-site after that cleanup lands.

## Non-goals

- No new content. The dialog body is the existing one, minus install actions.
- No "edit", "uninstall", or other write actions in this dialog. Those stay on
  `applet-detail-card` and the group settings flow.
- No instance-detail view — right-clicking shows the **tool**, not the per-applet
  instance, even when a group has multiple instances of the same tool.
- Don't redesign moss-store; expose just enough state for a global lookup.

## Forward-looking design constraint — first-run / not-yet-activated tools

Coming next (separate PR, but inform the shape now): the group's tool list will
include tools that are **available to the group but not yet activated** by the
current agent. First click on one will open this same dialog, with extra "first
run" instructions and (presumably) an activation action.

That changes a few choices in this plan:

- The dialog input must distinguish **activated-here** vs **available-but-not-activated-here**.
  Keep the discriminator explicit on the input shape so the future state is a new
  variant, not a flag retrofit. See "Dialog input shape" below.
- The resolver should be able to answer "is this tool activated for *this* agent
  in *this* group?" — i.e. resolve from `(groupDnaHash, toolCompatibilityId)`, not
  only from `appletHash`. The `appletHash` form will keep working; the
  `(group, toolId)` form is what the future first-run flow will use.
- Don't bake "right-click only" into the dialog or resolver. Left-click on a
  not-yet-activated tool will open the same component.

## Sources of truth (as-is)

- Dialog body: [src/renderer/src/personal-views/tool-library/elements/library-tool-details.ts](src/renderer/src/personal-views/tool-library/elements/library-tool-details.ts) — takes `unifiedTool: UnifiedToolEntry`, dispatches `install-tool-to-group`. Install buttons rendered unconditionally at lines ~224-260 and inside the Versions tab (~64).
- Dialog wrapper: [src/renderer/src/personal-views/tool-library/elements/installable-tools-web2.ts:204-205](src/renderer/src/personal-views/tool-library/elements/installable-tools-web2.ts#L204-L205) — `<moss-dialog>` + state lives on the page component.
- Generic dialog primitive: [src/renderer/src/elements/_new_design/moss-dialog.ts](src/renderer/src/elements/_new_design/moss-dialog.ts).
- Unified entry construction: [src/renderer/src/utils.ts:215-263](src/renderer/src/utils.ts#L215-L263) (`groupToolsByBaseId`).
- Per-applet tool identity: `applet.distribution_info` (JSON) → `toolListUrl`, `toolId`, `versionBranch`. Helper `toolCompatibilityIdFromDistInfoString` exists in `@theweave/utils`.
- Library data today only lives on the page component [src/renderer/src/personal-views/tool-library/tool-library-web2.ts:105,114,260](src/renderer/src/personal-views/tool-library/tool-library-web2.ts) — not in the store.

## Architecture

Three pieces, each independently shippable.

### Piece A — `library-tool-details` gets an `informational` mode

A boolean prop. When `true`:

- Skip the top-right install button (~224-260).
- Skip the per-version install buttons in the Versions tab.
- Everything else (overview, tags, versions list, changelog) renders unchanged.

Optional second prop `installedAs?: string` — when set, render a small
"(installed as: …)" line near the title. Driven by `applet.custom_name` from the
calling site. (Answer to former open question 2: yes, include this.)

That's the entire change in this file. No event removal; just don't render the buttons.

### Piece B — Global "tool info dialog" host

A single mounted instance owns the `<moss-dialog>` + `<library-tool-details informational>`. Right-click sites don't each carry their own dialog.

- New element `tool-info-dialog` (suggested location: `src/renderer/src/elements/tool-info-dialog.ts`) wraps `moss-dialog` + `library-tool-details`. Exposes `show(input)` / `hide()`.
- **Dialog input shape** — discriminated union, designed so the future first-run variant slots in:
  ```ts
  type ToolInfoInput =
    | { kind: 'activated-applet'; appletHash: EntryHash }      // v1 — group sidebar right-click
    | { kind: 'unified'; tool: UnifiedToolEntry }              // direct, e.g. future library reuse
    | { kind: 'available-tool';                                // future — first-run flow
        groupDnaHash: DnaHash;
        toolCompatibilityId: string };
  ```
  v1 implements the first two; the third is reserved (resolver supports it, dialog can stub a "not implemented yet" path or simply not be invoked with it).
- Mount **once** at the app root. Candidate: `src/renderer/src/we-app.ts` or wherever the existing root-level dialogs sit. Pick whichever already hosts the splash/error overlays so z-index and lifecycle match.
- Trigger via a bubbling custom event `open-tool-info` carrying the input. The host listens at the root. This avoids passing the dialog ref through every render site.

### Piece C — resolver: input → `UnifiedToolEntry` (+ activation context)

Today the `unifiedTools` map only exists on the tool-library page. We need it globally.

- Move (or duplicate-as-derived-store) the tool-library fetch + grouping into `moss-store`. Expose:
  - `unifiedToolsStore: AsyncReadable<Map<baseId, UnifiedToolEntry>>`
  - `resolveToolInfo(input: ToolInfoInput): Promise<ResolvedToolInfo>`
- `ResolvedToolInfo` shape:
  ```ts
  type ResolvedToolInfo = {
    tool: UnifiedToolEntry | { fallback: AppletFallbackInfo };
    activation:
      | { state: 'activated'; appletHash: EntryHash; customName?: string }
      | { state: 'available'; groupDnaHash: DnaHash }   // future
      | { state: 'unknown' };                            // unified-only input
  };
  ```
  The dialog uses `tool` for the body and `activation` to decide the
  "(installed as: …)" line / future first-run banner.
- Resolver steps for `kind: 'activated-applet'`:
  1. Load the `Applet` (already cached in group store — `appletsForToolId` proves the access path: [src/renderer/src/moss-store.ts:1543-1560](src/renderer/src/moss-store.ts#L1543-L1560)).
  2. Parse `distribution_info` → `toolCompatibilityId` via existing `@theweave/utils` helper.
  3. Derive `baseId` (MD5 of `toolListUrl#toolId`) per `groupToolsByBaseId` ([utils.ts:215-263](src/renderer/src/utils.ts#L215-L263)).
  4. Look up in `unifiedToolsStore`. Hit → return with `activation.state = 'activated'` + `customName` from `applet.custom_name`.
  5. Miss (offline / source curation gone / dev applet) → return a minimal fallback built from `applet` fields + cached icon. The dialog can render a "limited info" variant from this. Don't block on network.
- For `kind: 'available-tool'` (future): same lookup by `toolCompatibilityId` against `unifiedToolsStore`, `activation.state = 'available'`. Stubbed-out implementation is fine in v1 — just keep the type.
- Update `tool-library-web2.ts` to consume the moss-store unified map instead of building its own — single source of truth.

## TDD plan

Per CLAUDE.md §1 each step ships with regression coverage.

### Status on this branch (`feat/tool-info-popup-only`)

**All tests below are deferred.** This branch ships the feature on top of
`main-0.6` without the e2e Playwright harness or any renderer-side Vitest
setup — neither exists in the repo today. The three unit specs and the e2e
spec are intentionally not implemented here; they land together with the
testing infrastructure on a follow-up branch.

Spec sources to honor when the infra lands:
- Unit test designs: this section (items 1-3 below).
- E2E #10 design: see the smoke #10 spec on `feat/tool-info-popup`
  (PR #210, file `tests/e2e/smoke/10.tool-info-popup.spec.ts`) — depends on
  smoke #4 (install-applet-from-library) being enabled.
- Review notes that flagged the gap: PR #210 review, "Correctness issues" §2
  ("Skipped is not the same as covered").

### Unit tests (Vitest)

1. `library-tool-details.informational-mode.test.ts` — mounts the component with `informational={true}`, asserts neither the primary install button nor any versions-tab install button is rendered; asserts overview/version content still renders. With `installedAs="My Forum"`, asserts the custom-name line is shown.
2. `tool-info-resolver.test.ts` — for `kind: 'activated-applet'`: given a fixture `Applet` + a fixture `unifiedTools` map, returns the right `UnifiedToolEntry` with `activation.state = 'activated'` and the correct `customName`; with the entry missing, returns the fallback shape; with malformed `distribution_info`, returns fallback (does not throw). Add a smoke case for `kind: 'unified'` passthrough.
3. `tool-info-dialog.test.ts` — fires `open-tool-info` event with `kind: 'activated-applet'` and `kind: 'unified'`; asserts dialog opens with the correct tool data and (where applicable) the `installed as` line.

### E2E (Playwright harness — not on this branch)

When the harness lands, add to `tests/e2e/smoke/`:

- `10.tool-info-popup.spec.ts` — right-click an installed applet in the **group sidebar** → assert dialog opens, install button is **absent**, close, assert no navigation occurred (URL/route unchanged from before right-click).

The test uses fixtures already wired in `tests/e2e/fixtures/moss.ts`. Single agent + an installed example applet should suffice.

## Implementation steps

Each step is a separate commit; CI gates each.

1. **Piece A first — pure UI change, lowest risk.**
   - Add `informational` + `installedAs` props to `library-tool-details`.
   - Conditionalize install button rendering and the custom-name line.
   - Unit test #N (deferred on this branch — see "Status" above): #1.
   - Existing library use sites unchanged (default `informational=false`, `installedAs` undefined).
2. **Piece C — resolver + store hoist.**
   - Hoist unified-tools building to moss-store; rewire tool-library-web2 to consume.
   - Add `resolveToolInfo` + `ResolvedToolInfo` (with `activation` field) + fallback type.
   - Implement `'activated-applet'` and `'unified'` paths; leave `'available-tool'` typed but stubbed (return `'available'` activation, look up tool by compatibility id, fallback otherwise).
   - Unit test #N (deferred on this branch — see "Status" above): #2.
   - No UI change yet; should be a pure refactor verified by existing library tests + typecheck.
3. **Piece B — dialog host + event wire-up.**
   - New `tool-info-dialog` element, mount at app root.
   - Listen for `open-tool-info`. On event, resolve input → render `library-tool-details informational installedAs=…`.
   - Unit test #N (deferred on this branch — see "Status" above): #3.
4. **Wire up right-click on the group tools sidebar (single site for v1).**
   - In `group-applets-row.ts`, add `@contextmenu` handler that fires `open-tool-info` with `kind: 'activated-applet'` and the applet hash. `e.preventDefault()` to suppress browser menu.
5. **E2E spec #10** (deferred — see "Status" above), plus a manual pass through the group sidebar (see Manual Verification below).

## Manual verification (UI feature, not just code correctness)

Per CLAUDE.md UI rule: type checks ≠ feature works. Before declaring done:

- `yarn applet-dev-example`, install the example applet in a group.
- Right-click a tool in the group sidebar; confirm:
  - Dialog opens centered, in front of current view.
  - No navigation/route change.
  - No install button visible.
  - "(installed as: …)" line shows when `applet.custom_name` is set.
  - ESC and clicking outside both close it.
  - Native browser context menu does *not* also appear.
- Test offline path: kill network, right-click an applet whose source isn't in `unifiedToolsStore` → fallback view renders, no error.

## Out of scope / follow-ups

- Right-click on other UI sites — defer until after the cruft cleanup lands; many candidate sites may be removed or moved.
- The "show all group tools incl. not-yet-activated, first-run dialog on first click" flow — separate plan, but the `ToolInfoInput`/`ResolvedToolInfo` shapes here are designed to absorb it without rework.
- Caching tool metadata locally so the offline fallback has richer content.
- Adding "View source", "Report issue" links to the informational view.
- Right-click menus with other actions (uninstall, rename, etc.) — this plan adds *only* the info-popup. A multi-action context menu is a separate design.
