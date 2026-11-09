# Design: Feedback threads, reporter identity, and GitHub linking

Written for a builder working in this repository on branch `main-0.7`
(Moss 0.16 line). It records the decisions taken in the 2026-11-08
brainstorm about the design-feedback feature, and what is left to the
builder. Every phase ships together in 0.16; the phases exist so each can be
built and tested on its own.

## Intent

Today a person presses the feedback icon, crops a screenshot, types a note,
and the note becomes a public GitHub issue on `lightningrodlabs/moss`. After
that the person is cut off: they cannot see whether the issue was answered,
cannot reply to a question from the triage team, and cannot say "this is
fixed". The triage team cannot tell which issues come from the same person.

This design closes that loop inside Moss. A person sees their issues split
into open and closed, reads replies from the team, answers them, and marks
their own issue resolved. Each reporter has a stable pseudonymous id so the
team can correlate issues. A person who wants to may link a GitHub account
and act under their own name.

It also replaces the previous ingress, which posted as a personal GitHub
account with a `repo` scoped token through an unauthenticated worker. That
worker has been taken down. Nothing ships until the signed, GitHub App based
ingress in phase 1 exists.

## Goals

- Every request from Moss to the feedback worker is signed by a per-profile
  key the worker can verify. Unsigned or replayed requests are rejected.
- The worker acts on GitHub as a GitHub App installed on one repo, never as
  a person.
- A reporter id derived from the profile's agent key appears on every issue
  that reporter creates. Nothing a compromised worker or database holds can
  be used to recover or confirm the agent key.
- Issues created from Moss show in Settings in two tabs, Open and Closed,
  with their comment thread. Comments from the team are visibly different
  from the reporter's own.
- The reporter can post a reply and can close an issue they created as
  resolved, from inside Moss, whether or not they linked GitHub.
- A reporter can link a GitHub account by the OAuth device flow. A linked
  reporter creates issues, replies and closes directly against GitHub as
  themself. The GitHub token never leaves the device.
- New replies from the team are noticed without the person opening Settings:
  an unread count on the Feedback tab and on the settings entry point.
- Every piece is covered by tests CI can run without Holochain.

## Non-goals

- Reopening a closed issue from Moss.
- Editing or deleting an issue or comment from Moss.
- Rendering GitHub markdown beyond plain paragraphs, links and inline code.
  Images in comments are shown as links.
- Private feedback. The "Copy" button and the email address stay as the
  private route.
- Reactions, labels, assignees, milestones.
- Any change to how the screenshot is captured or cropped.
- Migrating the issues already created with the old worker into threads. They
  keep their "View Issue" link.

## Anti-goals

- Reusing a personal access token anywhere in the new worker.
- Any design in which the raw agent pubkey, or anything that can be checked
  against it, reaches the worker, Cloudflare logs, or D1.
- A worker that holds users' GitHub tokens.
- Logging request headers, IP addresses or bodies in the worker beyond
  Cloudflare's default error reporting.

## Constraints

- Electron 32 main process, Node 20 crypto. Ed25519 is available in
  `node:crypto` natively; no new dependency for key derivation or signing.
- Cloudflare Workers: WebCrypto `Ed25519` for verification, D1 for storage,
  KV for nonces and rate counters, R2 for screenshots. The worker stays in
  `workers/design-feedback`.
- Signing with the agent key goes through the existing lair handle
  (`WeRustHandler.signZomeCall`, which is a passthrough to lair's
  `sign_by_pub_key`). The renderer never signs anything.
- The worker stays an npm package of its own, outside the yarn workspaces.
  It imports the shared signing module by relative path
  (`../../../shared/utils/src/feedback/`), which wrangler's esbuild bundles
  as plain TypeScript. Its tests run with its own vitest config in
  `workers/design-feedback` and a separate CI job, so the root install, the
  root typecheck and `yarn setup` are untouched. (Builder's call, settled
  here.)
- Both workers, D1 databases, KV namespaces and R2 buckets live on the
  existing personal Cloudflare account that hosted the old worker. Production
  is `moss-design-feedback`, staging is `moss-design-feedback-staging`, each
  with its own D1, KV and R2. Repo owner and name, R2 public URL, GitHub App
  ids and the webhook secret are wrangler `[vars]` and secrets, with an
  `[env.staging]` block, never constants in the worker source. The staging
  repo receives a webhook pointed at the staging worker and the production
  repo one pointed at production. On the Moss side `feedbackWorkerUrl` in
  `moss.config.json` stays the production URL and the dev config
  (`weave.*.config.ts`) may override it so a dev build talks to staging.
  (Builder's call, settled here.)
- Strong typing everywhere; shared request and response types live in one
  module both sides import.
- File sizes stay small. Feedback code in the main process goes in
  `src/main/feedback/`, not `src/main/index.ts`. Renderer feedback views get
  their own files under `src/renderer/src/app/design-feedback/`.
- UI follows existing practice: `sl-tab-group` for tabs, `sl-tooltip` for
  hover text, `moss-button` classes, `msg()` for every string with XLIFF
  updates for all nine locales.
- Code comments explain intent, never the change.

## Decisions

### Phase 1: secure ingress and reporter identity

**GitHub App.** A GitHub App owned by the `lightningrodlabs` org, with
permissions Issues: read and write, Metadata: read, installed on the org for
exactly two repos: `lightningrodlabs/moss` (production) and a new
`lightningrodlabs/moss-feedback-staging` (staging). One installation covers
both, so one set of app credentials serves both worker environments and the
repo name is the only per-environment difference. The worker holds the app id, the installation id, and the
app's private key as Wrangler secrets, mints a JWT, exchanges it for a one
hour installation token, and caches that token in memory for its lifetime.
Issues and comments it creates appear as the app's bot user. The same app
provides the device flow in phase 3, so it also needs a client id, a client
secret stored in the worker, and Device Flow enabled. The current personal
access token is revoked the day the new worker is deployed.

**Reporter key.** The profile's agent key is the one its installed group
apps use (`globalPubKeyFromListAppsResponse`). At first use the main process
asks lair to sign the fixed bytes `moss-feedback-key-v1` with that key, and
uses SHA-256 of the signature as the seed of an Ed25519 keypair built with
`node:crypto`. The seed is held in memory only and recomputed on each start.
The derived keypair is the reporter key. Its public key is the only key the
worker ever sees. Ed25519 signatures are deterministic, so the same agent
key always derives the same reporter key; distinct agent keys derive
unrelated ones. The fixed message starts with ASCII, which can never decode
as a msgpack `CallZomeRequest`, so this signature can never be replayed as a
zome call.

A profile with no group app has no agent key and therefore no reporter key.
In that state the Design Feedback Mode switch in Settings is disabled with
help text saying feedback becomes available after joining or creating a
group. Nothing else enforces this. A profile that leaves every group and
later joins another gets a new agent key and so a new reporter id; the id is
useful for correlation, not critical, and this drift is accepted. Key
allocation for groups is not changed by this design.

**Reporter id.** `reporterId = base64url(sha256(reporterPubKey))[0..12]`.
This twelve character id appears in the issue body in a visible
"Reporter: `abc123def456`" line and inside an HTML comment
`<!-- moss-feedback reporter=abc123def456 -->` so it survives body edits by
the team and can be parsed back if D1 is lost. The worker stores the full
reporter public key in D1 keyed by this id.

**Request signing.** Every Moss to worker request carries:

```
X-Moss-Reporter: <base64url reporterPubKey, 32 bytes>
X-Moss-Timestamp: <unix seconds>
X-Moss-Nonce: <base64url 16 random bytes>
X-Moss-Signature: <base64url Ed25519 signature>
```

The signature is over the UTF-8 bytes of

```
moss-feedback-v1\n
<METHOD>\n
<path>\n
<timestamp>\n
<nonce>\n
<base64url sha256(body)>
```

The worker rejects a timestamp more than 300 seconds from its clock, a nonce
seen before (KV, TTL 600 seconds), and a bad signature. The canonical string
builder and the header names live in one TypeScript module under
`shared/utils/src/feedback/` with no Node or Workers imports, so the main
process and the worker import the same code and the unit tests exercise both
sign and verify against fixed vectors.

**Rate limits and payload.** Per reporter: 10 issue creations per hour, 60
comments per hour. Per IP: 30 requests per minute. Counters in KV. Screenshot
PNG at most 2 MB after decoding, and the first eight bytes must be the PNG
signature. Text at most 10,000 characters. Oversize or malformed input is a
400 with no R2 write.

**Where submission happens.** The renderer stops calling the worker. A new
`src/main/feedback/` module owns the local records, the reporter key, the
worker client and later the GitHub client. The renderer calls
`submitFeedback`, which writes the local record, posts to the worker, and
returns the record with its issue number and URL filled in. Local records
gain `issueNumber`, `reporterId`, `state`, and later `comments`,
`lastReadAt`, `createdVia`.

**Issue body.** The issue body keeps its present sections and adds the
reporter line and the HTML marker. The optional unverified GitHub handle
field, when filled, adds a "GitHub: @handle" line. The field is a plain
`sl-input` in the feedback dialog and in settings with help text saying it is
not verified. Ship it in phase 1; phase 3 replaces the setting with the real
link, but a linked user can still leave it blank.

**Dialog disclaimer.** The disclaimer gains one sentence stating that a
pseudonymous reporter id, the same for every issue from this profile, is
included so the team can follow up, and that it cannot be traced back to the
person or their groups.

**Worker routes after phase 1.**

| Route | Auth | Does |
|---|---|---|
| `POST /v1/issues` | signed | validates, stores PNG in R2, creates the issue as the app, records `(issueNumber, reporterId, createdVia='worker')` in D1, returns `{ issueNumber, issueUrl }` |

The old unversioned `/feedback` route is not carried over. The old worker
has already been taken down; 0.15 builds get "saved locally" and no legacy
support is built.

### Phase 2: threads, status, reply, resolve

**Source of truth is GitHub.** D1 holds a mirror filled by GitHub webhooks.
Tables:

```
reporters(reporter_id TEXT PK, pubkey BLOB, created_at INTEGER)
issues(number INTEGER PK, reporter_id TEXT, state TEXT, state_reason TEXT,
       title TEXT, created_at INTEGER, updated_at INTEGER, created_via TEXT)
comments(id INTEGER PK, issue_number INTEGER, author_login TEXT,
         author_association TEXT, posted_for_reporter INTEGER,
         body TEXT, created_at INTEGER, updated_at INTEGER)
```

`posted_for_reporter` is 1 for a comment the worker posted on the reporter's
behalf. The worker records it at post time, so it never depends on parsing
the comment body.

**Webhook.** The GitHub App subscribes to `issues` and `issue_comment`. The
worker's `POST /v1/webhook` verifies `X-Hub-Signature-256` with the webhook
secret and upserts into `issues` and `comments`. Events for issues not in
`issues` are ignored unless the body carries the HTML reporter marker, in
which case the row is created from the marker so an issue created directly
on GitHub by a linked user, or one whose D1 row was lost, still gets tracked.
Edits and deletions of comments are applied; `issues.edited` updates the
title.

**Sync.** `POST /v1/sync` is signed. Body: the list of issue numbers from the
local records and, per issue, the `updated_at` the client last saw. The
worker answers from D1 only, with each issue's state and any comment created
or edited after the client's cursor. It never calls GitHub during a sync.
Issue numbers that belong to a different reporter are omitted from the
response, not an error, so the client cannot probe. Issues missing from D1
trigger a one-time backfill from the GitHub API using the installation token,
limited to issues whose body carries this reporter's marker.

**Who is "the team".** A comment whose `author_association` is `OWNER`,
`MEMBER` or `COLLABORATOR` is from the team. Everything else is "other".
Comments with `posted_for_reporter=1` are the reporter's. In the UI these
three render differently and only team comments count as unread.

**Reply.** `POST /v1/issues/:number/comments`, signed. The worker checks the
issue's `reporter_id` matches the request, posts as the app with the body
prefixed by a single line `**Reporter** replied:` followed by the text
quoted, and records the comment with `posted_for_reporter=1`.

**Resolve.** `POST /v1/issues/:number/resolve`, signed, same ownership check.
The worker posts a comment "Closed as resolved by the reporter from Moss"
and patches the issue to `state: closed`, `state_reason: completed`. Only
open issues can be resolved; a closed one is a 409.

**Polling cadence.** The main process polls `/v1/sync` on startup once the
conductor is up, every 10 minutes while the window is open, and immediately
when the Feedback tab opens or a reply or resolve succeeds. Nothing is polled
when there are no local records with an issue number.

**Renderer.** The Feedback settings tab is split into files:

- `feedback-settings.ts`: the mode switch, the GitHub section, and the
  history container.
- `feedback-history.ts`: an `sl-tab-group` with Open and Closed; each tab
  lists `feedback-issue-card` elements newest first.
- `feedback-issue-card.ts`: collapsed shows title, date, unread count badge,
  "View on GitHub" link. Expanded shows the original text, the thread, a
  reply `sl-textarea` with a Send button, and for open issues created by
  this profile a "Mark resolved" button with an `sl-tooltip`.

Expanding a card marks its comments read by setting the local record's
`lastReadAt`. The unread total is the number of team comments newer than
`lastReadAt` across all records; it is shown as a badge on the Feedback tab
label and on the settings icon in the main dashboard, using the same badge
style the dashboard already uses for group notification counts.

Records without an issue number, the pre-existing local-only ones, show
under Open with the existing "Copy" button and no thread.

### Phase 3: GitHub account linking

**Device flow.** Settings gets "Connect GitHub". The main process calls
`POST https://github.com/login/device/code` with the app's client id and no
scope, shows the user code and a button that opens the verification URL in
the system browser, and polls `POST https://github.com/login/oauth/access_token`
at the returned interval until it gets a token or the code expires. The
token is encrypted with Electron `safeStorage` and written under the profile
data directory. The renderer only ever learns `{ login, avatarUrl }`.

**Token lifetime.** "Expire user authorization tokens" is left off in the app
settings so there is no refresh flow. If GitHub later forces expiry, the
builder adds refresh handling; the storage format already has room for a
refresh token and expiry.

**Linked behaviour.** With a stored token, `submitFeedback` uploads the
screenshot to the worker (`POST /v1/screenshots`, signed, returns the R2
URL), then creates the issue itself against the GitHub API with the same
body including the reporter marker, then tells the worker
`POST /v1/issues/:number/claim` (signed) so D1 records
`(number, reporterId, createdVia='github')`. Reply and resolve call GitHub
directly with the user's token; the webhook brings the result into D1 and
the next sync brings it to the UI. The worker never sees the user token.

**Ownership check for claim.** The worker fetches the issue from GitHub and
accepts the claim only if the body carries this reporter's marker. Without
that an attacker could attach someone else's issue to their reporter id and
read its thread through sync.

**Disconnect.** Deletes the local token and calls `POST /v1/github/revoke`
(signed) with the token, which the worker forwards to GitHub's
`DELETE /applications/{client_id}/token` using the client secret, then
discards. This is the only moment a user token passes through the worker,
it is not stored, and the call exists only because revocation requires the
client secret.

**Spike before building phase 3.** Confirm that a user-to-server token from
the GitHub App lets a non-collaborator create an issue and comment on a
public repo where the app is installed. If it does not, switch the device
flow to a classic OAuth App with `public_repo` scope and add the broader
scope to the disclaimer; everything else in this phase is unchanged.

## Testing

- `shared/utils` feedback module: canonical string, sign and verify with
  fixed vectors, timestamp window, replay detection logic as pure
  functions. Vitest, no Holochain.
- Main process `src/main/feedback/`: key derivation from a fake lair signer
  produces a stable keypair and id; local record store round-trips; worker
  client builds correct headers; sync merge updates `state` and `comments`
  and unread count. Vitest with mocked fetch.
- Worker: `@cloudflare/vitest-pool-workers` with D1 and KV bindings. Covers
  signature rejection, nonce replay, rate limits, PNG validation, webhook
  HMAC, ownership checks on comment, resolve and claim, and sync omitting
  foreign issues.
- Renderer: the existing renderer unit tests are node-environment tests of
  pure functions with no DOM harness, and this design adds none. The tab
  split, unread count, "is this comment from the team" classification and
  read-marking are extracted into pure functions in their own module under
  `src/renderer/src/app/design-feedback/` and tested there. The Lit
  components themselves are covered by the manual checklist only.
  (Builder's call, settled here.)
- A manual two-profile checklist in `plans/` for the end-to-end path
  against the staging repo and worker, since GitHub cannot be driven in CI.
  CI never talks to GitHub or Cloudflare.

## Left to the builder

- Exact D1 index set and the migration file layout under
  `workers/design-feedback/migrations/`.
- How the installation token cache survives a cold start.
- Whether the sync request batches more than 100 issue numbers in one call
  or pages. No reporter will realistically have more.
- Markdown rendering choice for comment bodies within the non-goal limits.
- The exact placement and size of the unread badge, matched to the existing
  group notification badge.
- Layout of the device-flow dialog, matched to the existing invite dialog.
- Wording of the new disclaimer sentence and all other new strings.
