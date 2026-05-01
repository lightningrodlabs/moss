# UI testing framework + dead-code cleanup

## Why this plan exists

The renderer carries cruft from the pre-`_new_design` era — components from when group tools were listed across the top of the main page rather than nested inside the group pane. We want to delete that code, but right now nothing protects against accidentally breaking a working flow during the cleanup. Tryorama covers the group/assets DNAs but there is no UI/integration coverage in the repo:

- No Playwright / Puppeteer / WebdriverIO config anywhere
- No `*.test.ts` files under `src/renderer/`
- No tests of the Electron main process or the IPC seam
- No exercise of the full applet-iframe → WeaveClient → conductor path

So the plan is **two-phase**: build a minimal but real UI testing harness first, lock down a smoke suite over the critical flows, then do the dead-code cleanup with that suite as the safety net. The harness becomes a permanent capability, not a one-shot.

## Goals & non-goals

**Goals**
- Detect renderer-level regressions before merge, especially in the flows the cleanup touches (groups list, group pane, tools inside group pane, settings).
- Give an LLM-driven dev loop a fast, deterministic feedback signal beyond `typecheck` + `lint`.
- Establish patterns (locators, fixtures, helpers) that age well as the UI keeps evolving.
- Enable confident deletion of `_old`-suffixed and pre-`_new_design` components.

**Non-goals**
- Full coverage of every component or branch. We are explicitly not chasing a coverage number.
- Visual-regression / pixel-diff testing across the whole UI. Maybe a small set later, only on stable views.
- Replacing tryorama. DNA tests stay where they are.
- Cross-platform (Mac/Win/Linux) E2E in CI on day one. Linux-only first; expand if cheap.

## Tool choice: Playwright (`_electron.launch`)

Researched alternatives: Puppeteer (no first-class Electron support), WebdriverIO + `@wdio/electron-service`, Spectron (deprecated). Playwright wins for this codebase specifically because:

1. **Shadow DOM piercing is automatic** for open shadow roots — every Lit component in `src/renderer/src/elements/` works with `getByRole` / `getByText` / `getByLabel` without manual traversal. ([Playwright Locators](https://playwright.dev/docs/locators))
2. **Nested iframe handling via chained `frameLocator()`** — exactly the topology of `applet-iframe` hosting applet UIs that themselves embed sub-iframes.
3. **Multi-window support via `electronApp.windows()` + `'window'` event** covers the four entry points (main, splashscreen, walwindow, selectmediasource) without tool-specific glue.
4. **Trace Viewer with `trace: 'on-first-retry'`** — produces a replayable artifact for every CI failure including DOM snapshots, network, and console. This is critical when the failure mode is "something happened during the 8s Holochain conductor startup".
5. **`test.extend()` fixtures** let us model a fresh profile dir + conductor + lair as a per-test resource cleanly.

Runner-up was WebdriverIO + `@wdio/electron-service` — its only real edge is built-in Electron main-process API mocking, which Moss does not need yet (we want to test against real IPC + real conductor).

Reference: [spaceagetv/electron-playwright-example](https://github.com/spaceagetv/electron-playwright-example), [Simon Willison's TIL](https://til.simonwillison.net/electron/testing-electron-playwright).

## Testing philosophy — explicit principles

Best-practice writing in 2025–2026 has shifted on two points relevant to us:

1. **Kent C. Dodds is publicly reconsidering the testing trophy** — with Playwright + browser-mode runners, E2E execution cost has converged with integration cost, and for apps whose value lives in cross-process seams (which Moss is — renderer ↔ main ↔ conductor ↔ applet), E2E should occupy a *larger* slice than the trophy suggested. ([Call Kent 2025](https://kentcdodds.com/calls/05/02/does-the-testing-trophy-need-updating-for-2025))
2. **The dominant LLM-test failure mode is tautology**: same agent writes code + tests in one turn, assertions just mirror the implementation, suite is green and the bug ships. ([dev.to postmortem](https://dev.to/jamesdev4123/when-ai-generated-tests-pass-but-miss-the-bug-a-postmortem-on-tautological-unit-tests-2ajp), [Qodo TestGen-LLM](https://www.qodo.ai/blog/we-created-the-first-open-source-implementation-of-metas-testgen-llm/) — only ~1 in 20 LLM-generated tests adds real value.)

That gives us this set of working principles:

- **Test the seams, not the components.** E2E is where Moss actually breaks. Don't write 200 component-level Vitest specs for Lit elements that already typecheck.
- **Suggested ratio:** ~20% pure unit (zome logic, `shared/utils` pure fns), ~30% integration (group-client against tryorama, store reducers, IPC handlers), ~50% E2E. Skewed up from the trophy on purpose.
- **Smoke first, then regression.** Lock a small, fast smoke suite over the 6–8 critical flows. Only add deeper coverage in response to a real bug or a refactor about to land.
- **Tests document intent.** Every test gets a one-line `// why:` comment when the assertion isn't self-evident — without it the next agent loop deletes the test that was protecting an invariant nobody remembers. ([Huntley on Ralph](https://ghuntley.com/ralph/))
- **Separate the writer and the reviewer.** When generating tests with an LLM, run a second pass with the explicit prompt *"what could be wrong that these tests wouldn't catch?"*. Otherwise tests will mirror the code they protect.
- **Locator priority: `getByRole` → `getByLabel`/`getByText` → `getByTestId` → CSS as last resort.** Role-based survives redesigns; reserve `data-testid` for opaque elements without a semantic role (icons, custom widgets). ([Tkdodo: Test IDs are an a11y smell](https://tkdodo.eu/blog/test-ids-are-an-a11y-smell))
- **Functional helpers, not a Page Object hierarchy.** A flat `tests/e2e/helpers/` module of small async functions (`joinGroup(page, seed)`, `installApplet(page, name)`) ages better than POM class trees in a UI evolving this fast. ([Page Objects vs Functional Helpers](https://dev.to/muratkeremozcan/page-objects-vs-functional-helpers-2akj))
- **Don't mock the conductor in E2E.** Moss's value is in the WebSocket path. Mock only HTTP-side concerns where realism doesn't matter (tool library, bootstrap server) using `page.route()`.
- **Snapshot/visual tests are deferred.** Only worthwhile on a small stable view set, with explicit masking of dynamic content (timestamps, agent pubkeys, network status). Not in phase 1.
- **Coverage % is not a goal.** A high number from LLM-generated tautological tests is actively misleading.

## Phased rollout

### Phase 0 — Spike (~½ day)

Get one Playwright test launching Moss to its `Running` state and asserting the main window is up. No fixtures yet, no helpers. Just prove `_electron.launch` works against `out/main/index.js` with a throwaway profile dir. If the conductor takes too long to start under test, this is where we discover it.

Deliverable: `tests/e2e/smoke.boot.spec.ts` — green locally.

### Phase 1 — Harness (~1–2 days)

- Add `playwright` + `@playwright/test` as workspace devDependency.
- `tests/e2e/playwright.config.ts` with: Linux-only project, `trace: 'on-first-retry'`, `video: 'retain-on-failure'`, screenshots on failure, single worker (Holochain ports), 60s default timeout.
- `tests/e2e/fixtures/moss.ts`: `test.extend()` providing
  - `electronApp` — launched with a fresh `profiles/<test-id>/` dir
  - `mainWindow` — first window after `Running` state
  - `cleanProfile` — teardown of profile dir + conductor + lair
  - `secondAgent` — factory that boots a second Moss instance with its own profile dir, tracked for teardown alongside the primary. Holochain admin/app WebSocket ports are auto-allocated by Moss via `get-port`, so no manual port offsets are needed; the second agent picks free ports automatically.
- `tests/e2e/helpers/`:
  - `bootToReady.ts` — wait for `MossAppState === 'Running'` (wire a `data-state` attribute on `moss-app` if not present)
  - `groups.ts` — `createGroup`, `joinGroupByInviteLink`
  - `tools.ts` — `installToolFromFilesystem`, `openToolInGroup`
  - `settings.ts` — `openSettings`, `changeLanguage`
- `package.json` script `test:e2e` (and `test:e2e:ui` for headed debug).
- CI: a new GitHub Actions job that runs `yarn build && yarn test:e2e`. Linux only, single Holochain version, no parallelism. Upload trace artifacts on failure.

### Phase 2 — Smoke suite (~2–3 days)

The **9 flows that must work for the build to be viable** (mirrors `MossAppState` machine in [`src/renderer/src/moss-app.ts`](src/renderer/src/moss-app.ts)):

1. **Boot to Running** — fresh profile, no group, lands on initial setup view.
2. **Create group (steps 1 & 2)** — name + avatar, transitions through `CreatingGroup`, lands in group view with empty tools.
3. **Join group by invite link** — given a fixture link, lands in the group.
4. **Install applet via the tool library** — open the tool library from the group pane, pick the example applet (published via the dev config's `toolCurations`), install it, and verify it appears inside the group pane (the new design — *not* the old top-bar).
5. **Open applet → applet iframe loads** — assert the iframe is reachable via `page.frameLocator()` and the WeaveClient handshake completes (look for a known DOM marker the example applet renders post-handshake).
6. **Switch between two groups** — both visible in `groups-sidebar`, click switches, group pane shows that group's tools.
7. **Open settings → change language → strings updated** — exercises `_new_design/moss-settings/` and `@lit/localize` runtime path.
8. **Quit and relaunch with same profile** — group + applet still there, no re-install needed.
9. **Second-agent activation of the installed tool** — launch a second Moss instance with its own profile dir (and port offset), have it join the same group as the agent from #2–#4, then activate the tool already installed by the first agent. Assert: (a) the second agent's group pane lists the tool, (b) activating it brings up the applet iframe and the WeaveClient handshake completes against this agent's conductor, and (c) the second agent appears in the first agent's group peer-list (the first window stays open and is polled — this is what proves the gossip/peer-discovery path is actually working end-to-end, not just that each agent is talking to its own conductor in isolation). This is the multi-agent peer-to-peer baseline — without it, the smoke suite is testing a single-agent app, not Moss.

These nine tests are the load-bearing piece. They lock down everything the cruft-cleanup might break.

### Phase 3 — Cleanup with the safety net (~1–2 days)

Now we delete. Confirmed dead from initial scan:
- [`src/renderer/src/elements/navigation/topbar-button-old.ts`](src/renderer/src/elements/navigation/topbar-button-old.ts) — 0 imports
- [`src/renderer/src/elements/navigation/sidebar-button-old.ts`](src/renderer/src/elements/navigation/sidebar-button-old.ts) — 0 imports

Suspected redundant with new design (verify with grep + run smoke suite after each removal):
- `tool-personal-bar-button.ts` — only one caller, may be obsolete
- Components in [`src/renderer/src/elements/`](src/renderer/src/elements/) referencing the pre-`_new_design` "tools across the top of the main page" layout
- Routes / view branches in [`src/renderer/src/elements/main-dashboard.ts`](src/renderer/src/elements/main-dashboard.ts) (72KB — likely the highest-payoff target) that are no longer reachable

Cleanup procedure for each candidate:
1. Grep imports across `src/`, `iframes/`, `libs/`, `shared/`. Zero hits → delete.
2. Run `yarn typecheck && yarn lint && yarn test:e2e`.
3. Commit per logical removal — small commits make the bisect easy if the smoke suite catches a regression three deletions later.

### Phase 4 — Targeted regression coverage (ongoing)

Every time a real bug surfaces in a flow not covered by smoke, add a regression test. This is how the suite grows — driven by failures, not by speculative coverage.

## File layout

```
tests/
  e2e/
    playwright.config.ts
    fixtures/
      moss.ts                     # electronApp, mainWindow, cleanProfile fixtures
      profiles/                   # tmp profile dirs (gitignored)
    helpers/
      bootToReady.ts
      groups.ts
      tools.ts
      settings.ts
    smoke/
      01.boot.spec.ts
      02.create-group.spec.ts
      03.join-group.spec.ts
      04.install-applet-from-library.spec.ts
      05.applet-iframe-handshake.spec.ts
      06.switch-groups.spec.ts
      07.settings-language.spec.ts
      08.relaunch-persistence.spec.ts
      09.second-agent-activates-tool.spec.ts
    regression/                   # Phase 4+, populated as bugs are found
```

The existing `tests/src/` (tryorama) is untouched. New `tests/e2e/` is a separate Playwright project.

## CI

Add a `e2e` job alongside the existing test job:
- Linux runner, nix shell with the same Holochain env that `yarn setup` uses.
- `yarn build && yarn build:zomes && yarn build:group-happ && yarn build:example-applet`.
- `yarn test:e2e` with `--reporter=list,html`.
- Upload `playwright-report/` and `test-results/` (traces + videos) on failure.
- Don't gate merges on it for the first week — let it shake out flakes — then make required.

## Notes from the Phase-0 spike

Things confirmed against a working harness, kept here so future implementations don't re-discover them:

- **Pass the repo root, not `out/main/index.js`, to `electron.launch`.** `app.getAppPath()` reads `moss.config.json` and `holochain-checksums.json` relative to the entry; only the repo-root path resolves them.
- **Strip `ELECTRON_RUN_AS_NODE` from the test env.** If it's set in the user's shell (some devs do this for ad-hoc scripting) Electron launches as Node and the main-process API is unavailable — surfacing as a confusing `electron.app.isPackaged` undefined error.
- **`program.allowUnknownOption(true)` on Moss's commander parser.** Electron forwards its own flags (`--inspect=0`, `--remote-debugging-port=0`, `--no-sandbox`) into argv when launched by Playwright; commander would otherwise abort startup.
- **In unpackaged builds, a fresh profile lands on `Running` (with no groups), not `InitialSetup`.** That branch is gated by `!app.isPackaged || RUN_OPTIONS.dev` — see [src/renderer/src/moss-app.ts:270](src/renderer/src/moss-app.ts#L270). All smoke specs assume unpackaged-build behavior unless we explicitly test a packaged build (deferred).
- **For now, always click Start Fresh on the LegacyKeystoreImport screen.** Testing the import-from-previous-version path is deliberately deferred to Phase 4. The `startFreshIfLegacyImport(page)` helper is idempotent.

## Risks & open questions

- **Conductor startup flake.** If 60s isn't enough on CI, raise it once, then investigate root cause rather than retry-looping. Track time-to-`Running` as a metric in the smoke suite.
- **Iframe handshake timing.** The applet-iframe → WeaveClient handshake is async over `postMessage`; the test for flow 5 needs a DOM marker the applet only renders post-handshake (add to example applet if missing).
- **Profile-dir cleanup on failure.** Make sure the fixture's teardown runs even when the test crashes — Playwright's `afterEach` does this but the lair-keystore subprocess needs explicit kill.
- **Closed shadow roots would break Playwright** — confirm all Lit components in `src/renderer/src/elements/` use the default open mode. Spot-check during Phase 1.
- **Test-IDs as accessibility smell.** Prefer `getByRole`/`getByLabel`. Only add `data-testid` where there is no semantic role available; flag those additions in PR review.

## Anti-patterns we are explicitly avoiding

- Same agent generating production code + its tests in the same turn (tautology).
- Snapshotting whole component trees.
- Mocking the conductor WebSocket in E2E.
- CSS class / `nth-child` selectors.
- A deep Page Object class hierarchy.
- Coverage % targets.
- Tests without a `// why:` comment when the intent isn't self-evident.

## Definition of done for this plan

- [ ] Playwright + fixtures landed, `yarn test:e2e` green locally on a clean checkout.
- [ ] All 9 smoke tests passing in CI.
- [ ] Confirmed-dead `*_old.ts` files removed.
- [ ] At least one round of Phase-3 cleanup of pre-`_new_design` components, each removal followed by a green smoke run.
- [ ] CI gating turned on for `test:e2e`.
- [ ] A short `tests/e2e/README.md` with the locator-priority rule, the writer-vs-reviewer rule, and how to run a single test headed.
