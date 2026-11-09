# Feedback threads: handoff for the implementing agent

Written for an agent picking this work up on another machine with no access
to the conversation that produced it. Read this first, then the spec, then
the phase 1 plan.

- Spec (all three phases): `docs/superpowers/specs/2026-11-09-feedback-threads-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-11-09-feedback-phase1-secure-ingress.md`
- Branch: `feat/feedback-phase1`, created from `origin/main-0.7` at `5bac45a9`.
  `main-0.7` is the active development line for Moss 0.16; `main` is stale.
  Check `git branch --show-current` before reading source.

## What the owner decided, and why

These were explicit decisions by the repository owner. Do not reopen them.

1. **GitHub App, not a personal or machine account.** The old worker posted
   with a personal access token with `repo` scope. The App is owned by the
   `lightningrodlabs` org, permissions Issues read/write and Metadata read,
   installed on `lightningrodlabs/moss` and a new
   `lightningrodlabs/moss-feedback-staging`.
2. **Linked GitHub users talk to GitHub directly.** Their token is stored on
   the device with Electron `safeStorage` and never reaches the worker. The
   worker must never hold user tokens.
3. **Reporter identity is a key derived from the agent key**, not the agent
   key itself and not a stored random key. Reason: a compromised worker or
   D1 must not be able to recover or confirm the agent key, since an agent
   pubkey is also a DHT address and links to group membership. Derivation:
   lair signs the fixed string `moss-feedback-key-v1` with the agent key;
   SHA-256 of that deterministic signature seeds an Ed25519 keypair. The
   derived pubkey is the only key the worker sees. The published reporter id
   is a 12 character base64url prefix of SHA-256 of that pubkey.
4. **Reporter id stability is useful, not critical.** The agent key comes
   from the profile's installed group apps. With no group there is no key
   and the Design Feedback Mode switch is disabled with a hint. If a profile
   leaves every group and joins another, it gets a new id. This drift is
   accepted. Do not change group key allocation to fix it.
5. **All phases ship together in Moss 0.16.** The phases exist so each can
   be built and tested on its own, not so they can ship separately. The
   unverified "GitHub handle" text field ships in phase 1 and stays optional
   after phase 3.
6. **No legacy support.** The old worker has already been taken down by the
   owner. 0.15 builds get "saved locally". Do not carry over the old
   unsigned `/feedback` route.
7. **Provisioning is all on the owner's personal Cloudflare account**, the
   one that hosted the old `moss-design-feedback` worker. Production and
   staging workers each get their own D1, KV and R2.
8. **Execution method chosen for phase 1: subagent-driven development**
   (`superpowers:subagent-driven-development`), one fresh implementer and
   one fresh reviewer per task, whole-branch review at the end.

## Facts about the codebase verified during design

These were checked against the code at the branch point. Verify again if
the tree has moved.

- Feedback today: renderer `src/renderer/src/app/design-feedback/`
  (controller, dialog, area selector) posts straight to the worker; main
  process handlers `save-feedback`, `list-feedback`, `get-feedback`,
  `update-feedback-issue-url`, `get-feedback-worker-url` live inline in
  `src/main/index.ts` around line 1678; history UI is the Feedback tab of
  `src/renderer/src/self/settings/moss-settings.ts`; records are JSON files
  in the profile's `data/feedback/` dir (`WE_FILE_SYSTEM.feedbackDir`).
- Worker: `workers/design-feedback/` (wrangler.toml, `src/index.ts`,
  npm-managed, not a yarn workspace). Current source is the old insecure
  version and is to be rewritten per the plan.
- Worker URL is `feedbackWorkerUrl` in `moss.config.json`, read through
  `MOSS_CONFIG` in `src/main/mossConfig.ts`.
- Lair signing: `WeRustHandler.signZomeCall(payload, pubKey)` in
  `@lightningrodlabs/we-rust-utils` is a plain passthrough to lair's
  `sign_by_pub_key` on the raw bytes it is given (confirmed in the Rust
  source, `we_rust_handler.rs`). It is usable for signing arbitrary bytes,
  which the key derivation relies on. `WE_RUST_HANDLER` is a `let` in the
  main closure of `src/main/index.ts` near line 577.
- Agent key: `globalPubKeyFromListAppsResponse(listApps())` in
  `shared/utils/src/utils.ts` returns the agent key of any installed
  `group#...` app. `getOrCreateAgentPubKey` in `src/main/index.ts` writes
  `keystore/moss-agent-pubkey.txt` but nothing reads it back except legacy
  import. This is why decision 4 exists.
- IPC: preload bridges in `src/preload/admin.ts`, renderer types in
  `src/renderer/src/electron-api.ts`. `src/main/ipc-contract-drift.test.ts`
  fails the build if a channel exists on one side only, so remove old
  channels on both sides in the same task.
- Unit tests: root `vitest.config.ts` includes `src/**/*.test.ts` and
  `shared/**/src/**/*.test.ts`, node environment, run with `yarn test:unit`.
  No DOM harness exists for renderer components.
- Extracted main modules follow the `registerXxxIpc(deps)` pattern, see
  `src/main/audioSourcesIpc.ts` and `src/main/asr/wireUp.ts`.
- Deep links use the `weave-0.16://` scheme; not needed for phase 3 because
  the device flow has no redirect.
- Electron 32 bundles Node 20; `node:crypto` has Ed25519. Cloudflare
  Workers support `Ed25519` in `crypto.subtle`.
- i18n: `msg()` strings, `cd src/renderer && npx lit-localize extract`,
  translate in `src/renderer/xliff/*.xlf` for de, fr, es, tr, it, pt, ja,
  nl, then `npx lit-localize build`.

## State of external resources

Nothing has been provisioned yet. Before phase 1 can be tested end to end,
the owner (or someone with org-owner rights on `lightningrodlabs` and the
Cloudflare login) must do the steps in the worker README that Task 16
writes. Until then every task is unit-testable with mocks and the Workers
vitest pool, which is how the plan is laid out.

- The old `moss-design-feedback` worker was taken down by the owner.
- Whether the old personal access token has been revoked is unknown.
  Remind the owner.
- `~/.config/.wrangler/config/default.toml` on the owner's machine held an
  expired Cloudflare login; `wrangler login` is needed before any deploy.
- `workers/design-feedback/node_modules` may exist locally from a
  `npm install` done during design; it is gitignored and irrelevant.

## Phases 2 and 3

Only phase 1 has a plan. When phase 1 is merged or at least complete on the
branch, write plans for phases 2 and 3 from the spec with
`superpowers:writing-plans`. Points that need care:

- Phase 2 adds the `comments` table in a second D1 migration, the GitHub
  webhook (enable it on the App, secret `WEBHOOK_SECRET`), the signed
  `/v1/sync`, comment and resolve routes, polling from the main process,
  and the renderer split into `feedback-settings.ts`, `feedback-history.ts`,
  `feedback-issue-card.ts` with pure derivation functions tested.
- Phase 3 has a required spike first: confirm a GitHub App user-to-server
  token from the device flow lets a non-collaborator create an issue and
  comment on a public repo where the App is installed. If not, fall back to
  a classic OAuth App with `public_repo` scope and add that to the
  disclaimer. Everything else in phase 3 is unchanged by the outcome.
- `createdVia: 'github'` records and the `/v1/issues/:number/claim` route
  exist so D1 learns about issues a linked user created directly. The
  ownership check on claim (body must carry this reporter's marker) is a
  security requirement, not a nicety.

## Calls the planner made that the owner has not reviewed in detail

Flag these in the PR description so the owner can object.

- Dev builds point at the staging worker through the environment variable
  `MOSS_FEEDBACK_WORKER_URL`, not a dev-config field.
- The Copy button reuses the `feedback-submit` IPC channel with
  `localOnly: true` rather than a separate channel.
- The worker stays an npm package outside the yarn workspaces and imports
  `shared/utils/src/feedback/` by relative path; its tests run in a separate
  CI job.
- Renderer tests cover extracted pure functions only.
- Rate limits, size caps and polling cadence are the spec's numbers.

## Repository conventions that apply

From `CLAUDE.md`: TDD so CI catches regressions; strong typing; code
comments explain intent, never the change; keep files small and split by
concern; reuse existing UI patterns (`sl-tooltip` for hover text,
`moss-button` classes, `aria-label` on icon-only buttons); no status
exclamation marks in reports; never add `Co-Authored-By` or "Generated with"
trailers to commits.
