# Moss E2E tests (Playwright + Electron)

End-to-end tests that drive the built Moss Electron app via
[`@playwright/test`](https://playwright.dev/) and assert against the renderer.

See [`plans/ui-testing-and-cruft-cleanup.md`](../../plans/ui-testing-and-cruft-cleanup.md)
for the philosophy, tool-choice rationale, and the smoke-suite contract.

## Running

These tests run against the **built** app, not a dev server. From repo root:

```bash
# 1. Build once (or after any renderer / main change)
yarn build

# 2. Run the suite
yarn test:e2e

# Variants
yarn test:e2e:ui       # Playwright UI mode (interactive, great for authoring)
yarn test:e2e:headed   # See the windows; useful for debugging selectors
```

You also need the Holochain + lair binaries fetched (`yarn fetch:binaries`,
included in `yarn setup`). Run from inside the project's nix shell so
`@lightningrodlabs/we-rust-utils` resolves correctly.

## Structure

```
e2e/
  playwright.config.ts             # single worker, traces on first retry
  fixtures/
    moss.ts                        # `test`, `expect`, launchMoss(), secondAgent()
  helpers/                         # functional helpers — flat, no class hierarchy
    bootToReady.ts
    groups.ts
    tools.ts
    settings.ts
  smoke/                           # the 9 load-bearing flows
    01.boot.spec.ts                # ← Phase-0 spike, the only one currently active
    02.create-group.spec.ts        # skipped — locator hardening pending
    03.join-group.spec.ts          # skipped
    04.install-applet-from-library.spec.ts
    05.applet-iframe-handshake.spec.ts
    06.switch-groups.spec.ts
    07.settings-language.spec.ts
    08.relaunch-persistence.spec.ts
    09.second-agent-activates-tool.spec.ts
  profiles/                        # tmp profile dirs (gitignored)
```

Phase-4 regression specs land under `e2e/regression/` once that phase begins.

## Working rules

These come straight from `plans/ui-testing-and-cruft-cleanup.md`. If you ignore
them the suite gets brittle and useless; please don't.

1. **Locator priority**: `getByRole` → `getByLabel` / `getByText` → `getByTestId` → CSS as a last resort. Only add `data-testid` to opaque elements with no semantic role.
2. **Functional helpers, no Page Object hierarchy.** Prefer small async functions in `helpers/`.
3. **Every test gets a `// why:` comment** when the assertion isn't self-evident. Without it the next agent loop deletes the test that was protecting an invariant nobody remembers.
4. **Don't mock the conductor.** Moss's value is in the WebSocket path. Mock only HTTP-side concerns via `page.route()` if you must.
5. **One test == one fresh profile.** The `moss` fixture handles this — never reach into `~/.config/Moss/profiles/` from a spec.
6. **When generating tests with an LLM**, do a separate review pass with the prompt: *"what could be wrong that these tests wouldn't catch?"*. Tests written in the same turn as the code they cover tend to be tautological.

## State synchronization

The renderer's `<moss-app>` element reflects `MossAppState` as `data-state`. Use
the `waitForState` / `waitForBoot` / `waitForRunning` helpers in
`helpers/bootToReady.ts` rather than racing on text.

If you find yourself tempted to add a new state name, add it to the
`MossStateName` union in `bootToReady.ts` so all tests typecheck against it.

## Multi-agent tests (smoke #9)

Use the `secondAgent` fixture to launch additional Moss instances. Holochain
ports are auto-allocated, so no manual port offsets are needed:

```ts
test('two agents in the same group', async ({ moss, secondAgent }) => {
  // ...agent 1 sets up a group, copies invite link...
  const agent2 = await secondAgent();
  // ...agent 2 joins, etc.
});
```

Both instances are torn down (and their profile dirs deleted) when the test
ends, even on failure.

## Debugging a failure

- Trace artifact: `test-results-e2e/<test>/trace.zip` → open with `npx playwright show-trace`.
- Video on failure: same dir.
- Run a single spec headed:
  ```
  yarn workspace tests test:e2e:headed e2e/smoke/01.boot.spec.ts
  ```

## What this suite does **not** cover

- Tryorama DNA tests (those live in `tests/src/` and run via `yarn test`).
- Cross-platform CI (Linux only — by plan).
- Visual regression. Deferred to a small stable view set later.
- Production update flows, signing-key rotation, anything requiring real network peers.
