# Renderer element reorganization — proposal

Companion to [ui-testing-and-cruft-cleanup.md](ui-testing-and-cruft-cleanup.md).
This is a **proposal for discussion**, not a migration that has been run.

## The problem

`src/renderer/src/elements/` is organized by *nothing*. It accreted a flat set of
folders (`navigation/`, `dialogs/`, `pocket/`, `creatables/`, `reusable/`,
`debugging-panel/`, …) plus a `_new_design/` folder that is organized by **when
the code was written** rather than **what it is about**. Meanwhile the renderer
*also* has feature directories at `src/renderer/src/` level (`groups/`,
`applets/`, `custom-views/`, `personal-views/`, `layout/`), each with its own
`elements/` subfolder. So a component's location today tells you which migration
wave wrote it — not which part of Moss it serves.

Renaming `_new_design/` to something nicer does not fix this. The folder should
not exist at all. A folder named after a redesign is a folder that will be wrong
again after the next redesign. **Organize by the thing the component is about.**

## The ontology to organize around

Moss has a small, stable conceptual vocabulary. It will outlive any visual
redesign, so it is the right spine for the directory tree:

- **Moss** — the runtime/shell itself: the window, the dashboard frame, app-level
  navigation and dialogs, the agent's runtime preferences (language,
  notifications), dev/debug surfaces. The container everything else runs inside.
- **Self** — the agent's own domain. The counterpart to a Group: a Group is a
  *shared* space; the Self is the space you occupy alone, plus your view across
  the shared ones. It covers four things:
  - **identity** — profile (create, edit, view, the profile prompt), avatar;
  - **runtime preferences** — the agent's Moss settings (language, notifications);
  - **personal home** — the landing surfaces of the non-group pane (welcome,
    activity);
  - **cross-group** — transverse views that aggregate across *all* the groups
    the agent belongs to: a unified calendar, all DMs across groups (Vines), the
    cross-group activity feed. These are not about any one Group — they are the
    Self's view *over* its Groups, so they belong to Self, not Group.
- **Group** — a private peer-to-peer network: its profile, its home/foyer, its
  settings, and — within it — **others**: the member roster, permissions,
  stewards.
- **Tool / Applet** — a **Tool** is the distributable artifact; an **Applet** is
  an installed instance of a Tool inside a Group. UI: applet logos/titles, the
  applet views, the per-group applet (tool) settings cards.
- **Tool Library** — discovery, installation, and publishing of Tools (developer
  collectives).
- **Asset** — a WAL (Weave Asset Locator) and the surfaces that move assets
  around: the pocket, creatables, asset tags, the asset viewer.

Two cross-cutting buckets that are *not* ontology, but are real:

- **UI primitives** — domain-free widgets (a dialog shell, a mini button, an
  avatar picker, a copy-hash chip, a tab group, icon sets). They are about
  *nothing* in the ontology, so they get their own home.
- **Dev/debug** — debugging panel, design-feedback. Internal tooling.

## Proposed structure

The renderer already commits to **feature-directory** organization for half its
code. The proposal is to finish that commitment: every UI element lives in the
feature directory of the ontological subject it serves, and `elements/` stops
being a catch-all. `_new_design/` is **dissolved**, not renamed.

```
src/renderer/src/
  app/                         the Moss runtime shell — the frame, not its contents
    main-dashboard.ts
    navigation/                groups-sidebar, personal-view-sidebar, sidebar-button,
                               group-sidebar-button, topbar-button, applet-topbar-button,
                               group-applets-row, applet-sidebar-button, group-area-sidebar
    dialogs/                   create-group, join-group, select-group, loading
    debug/                     debugging-panel/*, design-feedback/*

  self/                        the agent's own domain
    profile/                   moss-create-profile, moss-edit-profile, moss-profile-detail,
                               moss-profile-prompt, profile-settings
    settings/                  moss-settings, language-settings, notification-settings,
                               danger-zone-settings        (from _new_design/moss-settings)
    home/                      welcome-view, activity-view  (from personal-views/)
    cross-group/               cross-group-main, cross-group-block  (from layout/views/)

  groups/elements/
    home/                      group-container, group-home, foyer-stream,
                               group-peers-status, looking-for-peers
    settings/                  group-settings, general-settings, tools-settings,
                               inactive-tools(+dialog), danger-zone, my-profile-settings
    members/                   group-member-list, agent-permission, agent-permission-button
    invite/                    invite-people-dialog, select-group

  applets/elements/            applet-logo(+raw), applet-title, applet-main-views,
                               group-applets, applet-detail-card,
                               applet-settings-card, base-applet-settings-card,
                               abandoned-applet-settings-card

  tool-library/                (promoted out of personal-views/) discovery + publishing
  assets/                      pocket/, creatables/, asset-tags/, the asset viewer,
                               assets-graph  (from personal-views/)
  custom-views/                (unchanged — already correct)

  ui/                          domain-free primitives: moss-dialog, moss-mini-button,
                               moss-select-avatar(+fancy), copy-hash, tab-group,
                               icons, defaultIcons
```

Why this serves a future agent browsing the code:

- **The path is the answer.** "Where is group settings UI?" → `groups/elements/settings/`.
  No need to know it was the *second* design.
- **Co-location with state.** `groups/` already holds `group-store.ts` /
  `context.ts`; its UI belongs beside them, not in a distant `elements/_new_design/`.
- **`ui/` is greppable as the no-domain layer.** A primitive in `ui/` is a signal:
  safe to reuse anywhere, owns no business logic.
- **Era-neutral.** Nothing in the tree references a redesign, so the next redesign
  edits files in place instead of spawning `_new_design_2/`.

## `_new_design/` dissolution — file-by-file — ✅ DONE

Completed (step 3). All 34 files moved to the homes below, `_new_design/`
removed; imports updated, typecheck + smoke #1/#2/#5 green. Commits:
`54cd15d0` (ui/), `5462c5c0` (self/), `d45ba061` (app/navigation/),
`2cc6c922` (groups/ + applets/).

| Current (`elements/_new_design/`) | New home |
|---|---|
| `navigation/applet-sidebar-button.ts`, `navigation/group-area-sidebar.ts` | `app/navigation/` |
| `moss-settings/*` (moss-settings, language-, notification-, danger-zone-settings) | `self/settings/` |
| `profile/*` (moss-create/edit/detail/prompt) | `self/profile/` |
| `moss-settings/profile-settings.ts` | `self/profile/` |
| `group-settings.ts`, `group-settings/general-settings.ts`, `tools-settings.ts`, `inactive-tools.ts`, `inactive-tools-dialog.ts`, `danger-zone.ts`, `my-profile-settings.ts`, `tool-settings-styles.ts`, `tool-settings-utils.ts` | `groups/elements/settings/` |
| `group-settings/group-member-list.ts`, `agent-permission-button.ts` | `groups/elements/members/` |
| `group-settings/applet-settings-card.ts`, `base-applet-settings-card.ts`, `abandoned-applet-settings-card.ts` | `applets/elements/` |
| `invite-people-dialog.ts`, `select-group.ts` | `groups/elements/invite/` |
| `moss-dialog.ts`, `moss-mini-button.ts`, `moss-select-avatar.ts`, `moss-select-avatar-fancy.ts`, `copy-hash.ts`, `icons.ts`, `defaultIcons.ts` | `ui/` |

## `personal-views/` dissolution — file-by-file

`personal-views/` has the same flaw as `_new_design/`: it is named for *where it
renders* (the non-group pane), not *what it is about*. Its contents belong to
three different subjects. Dissolve it.

| Current (`personal-views/`) | New home | Why |
|---|---|---|
| `welcome-view/*`, `activity-view/*` | `self/home/` | the agent's personal landing — updates, notifications, the cross-group "Activity Currents" feed |
| `assets-graph/*` | `assets/` | a visualization of Assets, not a "personal view" |
| `tool-library/*` | `tool-library/` (top level) | about discovering/installing **Tools** |
| `tool-publishing/*` | `tool-library/publishing/` | developer collectives publishing **Tools** |

Note `activity-view` is itself a *cross-group* surface — it aggregates activity
over all the agent's groups — which is why `self/` (broad reading) is its home,
not `groups/`.

Also from `layout/views/`: `cross-group-main.ts`, `cross-group-block.ts` →
`self/cross-group/`. These render the transverse cross-group tool views (a
unified calendar, all DMs across groups). The rest of `layout/views/`
(`applet-*`, `asset-view`, `view-frame`) is genuine view-hosting machinery and
stays in `layout/`.

## Old/new design twins to delete during the move

The redesign left **superseded old-design twins** still in the tree, imported by
`groups/elements/group-home.ts` but (per a render-path trace) never rendered.
Each must be confirmed dead the same way as the [dead-code inventory](dead-code-inventory.md)
(grep + smoke run), then deleted as part of landing its new-design replacement:

| Old (delete, pending verification) | Replaced by |
|---|---|
| `groups/elements/group-applets-settings.ts` | `group-settings/tools-settings.ts` |
| `groups/elements/edit-group-profile.ts` | `group-settings/general-settings.ts` |
| `groups/elements/your-settings.ts` | `moss-settings/*` |
| `groups/elements/stewards-settings.ts` | `group-member-list.ts` + general settings |
| `groups/elements/abandoned-applet-card.ts` | `abandoned-applet-settings-card.ts` |

Confirmed orphans (zero imports) found in the same sweep, deletable independently:
`groups/elements/group-title.ts`, `groups/elements/applet-name.ts`,
`groups/elements/custom-view-title.ts`, `applets/elements/applet-title.ts`.

## The pre-`_new_design` top-bar — kill-switched, delete the whole subtree

This is the *original* group-tools-listing layout the whole cleanup exists to
remove. It is not an orphan — every file has live `import` statements — but it is
dead by **render path**: the only mount point is gated by a hardcoded `false`
([main-dashboard.ts:1705](../src/renderer/src/elements/main-dashboard.ts#L1705),
`${false && … <personal-view-sidebar> … }`). Verified by tracing `<tag>` render
sites. Full detail in item #6 of the [dead-code inventory](dead-code-inventory.md).

Four files, 623 lines, all dead — delete together with the `false &&` top-bar
block (`main-dashboard.ts` 1704–1758):

| File | Why dead |
|---|---|
| `navigation/personal-view-sidebar.ts` | only render site is the `false &&` block |
| `navigation/tool-personal-bar-button.ts` | `<tool-personal-bar-button>` rendered nowhere |
| `navigation/applet-topbar-button.ts` | `<applet-topbar-button>` rendered nowhere |
| `navigation/topbar-button.ts` | `<topbar-button>` rendered only by the two above |

Also drop the now-stale `applet-topbar-button.js` / `topbar-button.js` side-effect
imports from `group-applets-row.ts` and `group-applets-creatables.ts` (both stay —
live via the creatables panels — they just never rendered those tags).

**Functionality is not lost.** `personal-view-sidebar.ts` holds the "Experimental
features" menu (clover button → cross-group tool navigation, "All streams",
"Artefacts graph"). That cross-group navigation is **already live** in
`personal-views/welcome-view/welcome-view.ts` as a near-verbatim
`renderExperimentalMenu` / `renderToolMenuItems`. The welcome-view copy is what
users see today; the subtree copy is the superseded original. When a better
cross-group UX is designed, welcome-view (or `git show` of the deleted file) is
the reference. Nothing needs parking in `self/utils/`.

## Suggested sequencing

Done in steps; each step is independently shippable and guarded by the e2e smoke
suite.

1. ✅ **DONE** — **Verify + delete the dead twins and orphans** — shrinks the
   surface before anything moves.
2. ✅ **DONE** — **Delete the pre-`_new_design` top-bar subtree** — the four
   files + the `false &&` block + the stale side-effect imports.
3. ✅ **DONE** — **Dissolve `_new_design/`** into the homes in the table above.
   `git mv` per ontological group; `_new_design/` removed.
4. **Reorganize the rest of `elements/`** into `app/`, `assets/`, `ui/` as the
   tree shows. Larger churn, lower urgency — can land incrementally.
5. **Dissolve `personal-views/`** into `self/home/`, `assets/`, and a promoted
   top-level `tool-library/`; move the `cross-group-*` views into
   `self/cross-group/`.

Steps 1–3 (the core of the user request) are done. Steps 4–5 are the broader
rationalization and can wait.

Each step is mechanical and guarded by the e2e smoke suite. Do `git mv` (never
delete+recreate) so `git log --follow` keeps working, and run
`yarn typecheck && yarn test:e2e` after each commit.
