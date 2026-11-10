# Feedback Phase 2: Threads, Status, Reply and Resolve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a reporter their GitHub issues split into Open and Closed with the comment thread, let them reply and mark their own issue resolved from inside Moss, and show an unread count for team replies.

**Architecture:** GitHub stays the source of truth. The worker mirrors issues and comments into D1 through a GitHub App webhook and answers signed `/v1/sync` requests from D1 only. The Moss main process polls sync, merges results into the local JSON records, computes the unread count and pushes it to the renderer. Reply and resolve are signed worker routes that act as the App after an ownership check. The renderer splits the Feedback settings tab into three Lit components and reuses the dashboard's notification badge.

**Tech Stack:** TypeScript, Electron 32 main process, Lit + Shoelace renderer, `marked` + DOMPurify (already in the renderer), Cloudflare Worker with D1, KV and `@cloudflare/vitest-pool-workers` 0.23, GitHub REST API as a GitHub App.

**Spec:** `docs/superpowers/specs/2026-11-09-feedback-threads-design.md` (Phase 2 section, Goals, Anti-goals, Constraints, Testing). Phase 1 is on this branch. its interfaces are listed per task.

**Branch:** `feat/feedback-phase2` off `feat/feedback-phase1` (stacked PR against `feat/feedback-phase1-0.16`).

## Global Constraints

- Signed routes use the phase 1 scheme unchanged: `buildSignedHeaders` / `authenticate`, 300 s window, nonce TTL 600 s, request size cap `FEEDBACK_LIMITS.maxRequestBytes`.
- New worker routes: `POST /v1/webhook` (HMAC, not signed), `POST /v1/sync`, `POST /v1/issues/:number/comments`, `POST /v1/issues/:number/resolve` (signed). Path regexes anchored, `:number` is `\d{1,9}`.
- Webhook signature header `X-Hub-Signature-256` with value `sha256=<lowercase hex HMAC-SHA256 of the raw body>` using secret `WEBHOOK_SECRET`. compared in constant time. a bad or missing signature is 401 `invalid_signature`. Events handled: `issues` (opened, edited, closed, reopened, deleted) and `issue_comment` (created, edited, deleted). Every other event is 204.
- Team is `author_association` in `OWNER`, `MEMBER`, `COLLABORATOR`. A comment with `posted_for_reporter = 1` is the reporter's. Everything else is `other`. Only team comments count as unread.
- Reply body posted to GitHub is exactly `**Reporter** replied:` then a blank line, then the reporter's text with every line prefixed `> `. Resolve posts the comment `Closed as resolved by the reporter from Moss` then patches `state: closed`, `state_reason: completed`. Resolving a closed issue is 409 `conflict`.
- Rate limits: comments 60 per reporter per hour (`commentScope`), IP 30 per minute. both reply and resolve consume `commentScope`.
- Sync never calls GitHub except the one-time backfill of an issue number absent from D1 whose body carries this reporter's marker. Issue numbers that belong to another reporter are omitted, never an error. A sync request carries at most 100 issue numbers. the client sends the 100 most recent.
- Poll cadence: once after the conductor launch, every 10 minutes (600,000 ms) while the window exists, and immediately when the Feedback tab opens or a reply or resolve succeeds. No poll when no local record has an `issueNumber`.
- Reply text: 1 to 10,000 characters after trim, same limit constant as issue text.
- Local record fields added: `comments`, `lastReadAt`, `issueUpdatedAt`, `stateReason`, `title`. `createdVia` already exists.
- Markdown in comments: paragraphs, links and inline code through the existing `markdownParseSafe`. images become links first.
- Every renderer string through `msg()` with translations in all eight locales. Feedback IPC types live in `src/main/feedback/ipc.ts` and are mirrored in `src/renderer/src/electron-api.ts` with the `/** Mirrors ... */` comment convention.
- Strong typing, no `any`. comments explain intent, never the change. no attribution trailers in commits. worker never logs headers, IPs or bodies. no secrets in `wrangler.toml`.

## Review Focus

- A webhook delivery for an issue the worker never created (filed by hand on GitHub) whose body carries a reporter marker: tracked from the marker. without a marker: ignored with 204. Pinned in Task 3.
- A sync request listing an issue number owned by a different reporter: the number is simply absent from the response and D1 is untouched. Pinned in Task 5.
- A team comment edited after the user read it: it stays read (unread counts creation time, not update time). Pinned in Task 1 and Task 8.
- A reply or resolve while the worker is unreachable: the UI shows a notice, nothing is written locally, the thread is unchanged. Pinned in Task 10 and Task 11.
- A webhook `issue_comment.deleted` for a comment the user already sees: the comment disappears on the next sync and the unread count drops if it was unread. Pinned in Task 3, Task 5 and Task 8.

---

### Task 1: Shared thread protocol, validators and classification

**Files:**
- Create: `shared/utils/src/feedback/threads.ts`
- Modify: `shared/utils/src/feedback/protocol.ts` (add `'conflict'` to `FeedbackErrorCode`)
- Modify: `shared/utils/src/feedback/index.ts`
- Test: `shared/utils/src/feedback/threads.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CommentRole = 'team' | 'reporter' | 'other';
  export type FeedbackCommentWire = {
    id: number. authorLogin: string. authorAssociation: string. postedForReporter: boolean;
    body: string. createdAt: number. updatedAt: number. deleted: boolean. // seconds
  };
  export type IssueState = 'open' | 'closed';
  export type SyncRequest = { issues: Array<{ number: number. since: number }> }. // since = last seen updatedAt, 0 for all
  export type SyncIssue = {
    number: number. state: IssueState. stateReason?: string. title: string;
    updatedAt: number. comments: FeedbackCommentWire[];
  };
  export type SyncResponse = { issues: SyncIssue[] };
  export type ReplyRequest = { text: string };
  export type ReplyResponse = { commentId: number. createdAt: number };
  export type ResolveResponse = { state: 'closed'. closedAt: number };
  export const SYNC_MAX_ISSUES = 100;
  export function validateSyncRequest(req: unknown): SyncRequest | FeedbackErrorResponse;
  export function validateReplyRequest(req: unknown): ReplyRequest | FeedbackErrorResponse;
  export function commentRole(c: { authorAssociation: string. postedForReporter: boolean }): CommentRole;
  export function unreadTeamComments(comments: FeedbackCommentWire[], lastReadAt: number | undefined): number;
  export function buildReplyBody(text: string): string;
  ```
  `validateSyncRequest`: `bad_request` unless `issues` is an array of at most `SYNC_MAX_ISSUES` objects with positive integer `number` and non-negative integer `since`. `validateReplyRequest`: trim, `bad_request` for empty, `text_too_long` above `FEEDBACK_LIMITS.maxTextChars`. returns the trimmed text. `commentRole`: `postedForReporter` wins, then the team set, then `other`. `unreadTeamComments`: count of comments with role `team`, `deleted === false` and `createdAt > (lastReadAt ?? 0)`. `buildReplyBody`: see Global Constraints.

- [ ] **Step 1: Write the failing tests**

```ts
it('classifies OWNER, MEMBER and COLLABORATOR as team, posted_for_reporter as reporter, else other');
it('unread counts team comments created after lastReadAt and ignores deleted and edited-only ones', () => {
  const read = [{ ...team, createdAt: 10, updatedAt: 50 }]; // edited after read
  expect(unreadTeamComments(read, 20)).toBe(0);
  expect(unreadTeamComments([{ ...team, createdAt: 30 }, { ...team, createdAt: 30, deleted: true }, { ...other, createdAt: 30 }], 20)).toBe(1);
  expect(unreadTeamComments([{ ...team, createdAt: 30 }], undefined)).toBe(1);
});
it('validateSyncRequest rejects more than 100 issues, non-integer numbers and negative since');
it('validateReplyRequest trims, rejects whitespace and text over 10000 chars');
it('buildReplyBody quotes every line under the Reporter header', () => {
  expect(buildReplyBody('a\nb')).toBe('**Reporter** replied:\n\n> a\n> b');
});
```

- [ ] **Step 2: Run to verify failure, implement, run to verify pass, build**

Run: `yarn vitest run shared/utils/src/feedback && yarn workspace @theweave/utils build`

- [ ] **Step 3: Commit**

```bash
git add shared/utils/src/feedback
git commit -m "feat(feedback): shared thread types, validators and comment classification"
```

---

### Task 2: D1 comments table and thread queries

**Files:**
- Create: `workers/design-feedback/migrations/0002_comments.sql`
- Modify: `workers/design-feedback/src/db.ts`
- Test: `workers/design-feedback/test/db.test.ts`

**Interfaces:**
- Migration:
  ```sql
  CREATE TABLE comments (id INTEGER PRIMARY KEY, issue_number INTEGER NOT NULL REFERENCES issues(number),
    author_login TEXT NOT NULL, author_association TEXT NOT NULL, posted_for_reporter INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
  CREATE INDEX comments_issue_updated ON comments(issue_number, updated_at);
  ```
- Produces, in `db.ts` (all times in seconds):
  ```ts
  export type CommentRow = { id: number. issueNumber: number. authorLogin: string. authorAssociation: string;
    postedForReporter: boolean. body: string. createdAt: number. updatedAt: number. deletedAt?: number };
  export type StoredIssue = { number: number. reporterId: string. state: 'open' | 'closed'. stateReason?: string;
    title: string. createdAt: number. updatedAt: number. createdVia: 'worker' | 'github' };
  export async function getIssue(db: D1Database, number: number): Promise<StoredIssue | undefined>;
  export async function upsertIssue(db: D1Database, row: StoredIssue): Promise<void>. // INSERT ... ON CONFLICT(number) DO UPDATE state, state_reason, title, updated_at
  export async function deleteIssue(db: D1Database, number: number): Promise<void>. // issue and its comments
  export async function upsertComment(db: D1Database, row: CommentRow): Promise<void>. // ON CONFLICT(id) DO UPDATE body, updated_at, author_association, deleted_at
  export async function softDeleteComment(db: D1Database, id: number, deletedAt: number): Promise<void>. // also bumps updated_at
  export async function commentsSince(db: D1Database, issueNumber: number, since: number): Promise<CommentRow[]>. // updated_at > since, ordered by created_at
  export async function touchIssue(db: D1Database, number: number, updatedAt: number): Promise<void>. // issues.updated_at = max(existing, updatedAt)
  ```
  `insertIssueStatement` (phase 1) gains `ON CONFLICT(number) DO NOTHING` so a webhook that arrives before the worker's own insert does not break `recordIssue`.
- The test harness applies all migrations already (`readD1Migrations`). nothing to change there.

- [ ] **Step 1: Write the failing tests**: round trip of `upsertIssue` then `getIssue`. `upsertIssue` on an existing number updates state and title but keeps `reporter_id` and `created_via`. `upsertComment` then `commentsSince(n, 0)` returns it, `commentsSince(n, updatedAt)` does not. `softDeleteComment` sets `deletedAt` and bumps `updatedAt` so it appears in `commentsSince`. `deleteIssue` removes comments. `recordIssue` twice for the same number does not throw.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `cd workers/design-feedback && npm test -- db && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add workers/design-feedback/migrations/0002_comments.sql workers/design-feedback/src/db.ts workers/design-feedback/test/db.test.ts
git commit -m "feat(feedback-worker): comments table and thread queries"
```

---

### Task 3: GitHub webhook route

**Files:**
- Create: `workers/design-feedback/src/webhook.ts` (signature check and event parsing)
- Create: `workers/design-feedback/src/routes/webhook.ts`
- Modify: `workers/design-feedback/src/env.ts` (add `WEBHOOK_SECRET: string`)
- Modify: `workers/design-feedback/src/index.ts` (register)
- Modify: `workers/design-feedback/vitest.config.ts` (binding `WEBHOOK_SECRET: 'test-webhook-secret'`)
- Test: `workers/design-feedback/test/webhook.test.ts`

**Interfaces:**
- Consumes: Task 2 db functions. `parseReporterMarker` (phase 1 shared).
- Produces:
  ```ts
  export async function verifyWebhookSignature(secret: string, body: Uint8Array, header: string | null): Promise<boolean>. // webhook.ts
  export type WebhookEvent =
    | { kind: 'issue'. action: string. issue: GitHubIssuePayload }
    | { kind: 'comment'. action: string. issue: GitHubIssuePayload. comment: GitHubCommentPayload }
    | { kind: 'ignored' };
  export function parseWebhookEvent(eventName: string | null, payload: unknown): WebhookEvent | 'bad_request';
  export function webhookRoute(): Route. // POST /v1/webhook
  ```
  `GitHubIssuePayload` = `{ number, state, state_reason, title, body, created_at, updated_at }`. `GitHubCommentPayload` = `{ id, body, created_at, updated_at, user: { login }, author_association }`. ISO timestamps are converted to seconds with `Math.floor(Date.parse(x) / 1000)`.
  Route logic: verify signature (401) → parse (`X-GitHub-Event` header. 400 on malformed JSON) → the payload's `repository.full_name` must equal `${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`, otherwise 204 (each environment has its own repository webhook, and a delivery for another repository must never touch this D1) → `ignored` is 204 → for `issue` events: find the issue in D1. if absent, `parseReporterMarker(issue.body)`. no marker → 204. marker → `upsertIssue` with `createdVia: 'github'` (reporter row must exist. if the reporter id is unknown → 204, because sync will backfill when that reporter appears). `deleted` → `deleteIssue`. otherwise `upsertIssue` → 204. For `comment` events on a tracked issue: `created`/`edited` → `upsertComment` with `postedForReporter: false`. `deleted` → `softDeleteComment`. then `touchIssue`. untracked issue → same marker logic first. A comment the worker itself posted arrives too. `upsertComment` must not reset `posted_for_reporter` (the `ON CONFLICT` update list excludes it).

- [ ] **Step 1: Write the failing tests** using a helper that signs a payload with `crypto.subtle` HMAC and posts through `SELF.fetch`: bad signature → 401 and nothing stored. a delivery whose `repository.full_name` is another repo → 204 and nothing stored. `ping` event → 204. `issues.opened` with a marker for a known reporter → row with `created_via 'github'`. `issues.opened` without a marker → 204 and no row. `issues.closed` on a tracked issue → `state 'closed'`, `state_reason 'completed'`. `issue_comment.created` → comment row, issue `updated_at` bumped. `issue_comment.deleted` → `deleted_at` set. `issue_comment.edited` for a comment inserted with `posted_for_reporter = 1` keeps that flag.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `cd workers/design-feedback && npm test -- webhook && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add workers/design-feedback/src workers/design-feedback/test/webhook.test.ts workers/design-feedback/vitest.config.ts
git commit -m "feat(feedback-worker): mirror issues and comments from the GitHub webhook"
```

---

### Task 4: GitHub client additions

**Files:**
- Modify: `workers/design-feedback/src/github.ts`
- Test: `workers/design-feedback/test/github.test.ts`

**Interfaces:**
- Produces (same headers, token and `GitHubError` handling as `createIssue`. response shapes guarded like phase 1):
  ```ts
  export type GitHubComment = { id: number. body: string. created_at: string. updated_at: string. user: { login: string }. author_association: string };
  export type GitHubIssue = { number: number. state: 'open' | 'closed'. state_reason: string | null. title: string. body: string | null. created_at: string. updated_at: string. html_url: string };
  export async function createComment(env: Env, number: number, body: string, fetchImpl?: typeof fetch): Promise<GitHubComment>;
  export async function closeIssue(env: Env, number: number, fetchImpl?: typeof fetch): Promise<GitHubIssue>. // PATCH { state: 'closed', state_reason: 'completed' }
  export async function getIssue(env: Env, number: number, fetchImpl?: typeof fetch): Promise<GitHubIssue>;
  export async function listIssueComments(env: Env, number: number, fetchImpl?: typeof fetch): Promise<GitHubComment[]>. // ?per_page=100, first page only
  ```

- [ ] **Step 1: Write the failing tests** with the recording fake `fetchImpl` used in phase 1: `createComment` POSTs to `/repos/o/r/issues/7/comments` with `{ body }`. `closeIssue` PATCHes `/repos/o/r/issues/7` with the exact state body. `getIssue` GETs and returns the parsed issue. `listIssueComments` GETs with `per_page=100`. a wrong shape throws `GitHubError`.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `cd workers/design-feedback && npm test -- github`

- [ ] **Step 3: Commit**

```bash
git add workers/design-feedback/src/github.ts workers/design-feedback/test/github.test.ts
git commit -m "feat(feedback-worker): comment, close and read issues as the app"
```

---

### Task 5: Signed sync route with marker-gated backfill

**Files:**
- Create: `workers/design-feedback/src/routes/sync.ts`
- Modify: `workers/design-feedback/src/index.ts`
- Test: `workers/design-feedback/test/sync.test.ts`

**Interfaces:**
- Consumes: `authenticate`, `ipScope`/`consume`, Task 1 `validateSyncRequest`, Task 2 db, Task 4 `getIssue`/`listIssueComments`, `parseReporterMarker`.
- Produces: `export function syncRoute(deps: { fetchImpl?: typeof fetch. nowMs?: () => number } = {}): Route` for `POST /v1/sync`.
  Logic: IP limit → authenticate → validate → for each requested number: `getIssue`. if present and `reporterId !== authed.reporterId` → skip. if present → include `{ number, state, stateReason, title, updatedAt, comments: commentsSince(number, since) }` mapped to `FeedbackCommentWire` (`deleted: deletedAt !== undefined`). if absent → backfill: `github.getIssue`. `parseReporterMarker(body) === authed.reporterId` or skip. `upsertIssue` (`createdVia: 'github'`) plus `upsertComment` for each of `listIssueComments`. then include as above with `since` ignored (full thread). A `GitHubError` during backfill skips that number only. Respond `jsonOk({ issues })`.

- [ ] **Step 1: Write the failing tests** (signed with `makeTestReporter`, route handler called directly with a fake `fetchImpl` as in `createIssue.test.ts`): own issue with two comments and `since: 0` → both returned with roles derivable (`authorAssociation`, `postedForReporter`). `since` equal to the first comment's `updatedAt` → only the second. foreign issue → omitted, 200. unknown number whose GitHub body carries this reporter's marker → backfilled into D1 with its comments and returned. unknown number with another marker → omitted and not stored. 101 numbers → 400 `bad_request`. unsigned → 401.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `cd workers/design-feedback && npm test -- sync && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add workers/design-feedback/src workers/design-feedback/test/sync.test.ts
git commit -m "feat(feedback-worker): signed sync of issue state and comments from D1"
```

---

### Task 6: Reply and resolve routes

**Files:**
- Create: `workers/design-feedback/src/routes/reply.ts`
- Create: `workers/design-feedback/src/routes/resolve.ts`
- Modify: `workers/design-feedback/src/index.ts`
- Test: `workers/design-feedback/test/reply.test.ts`, `workers/design-feedback/test/resolve.test.ts`

**Interfaces:**
- Consumes: Task 1 `validateReplyRequest`, `buildReplyBody`. Task 2 db. Task 4 `createComment`, `closeIssue`. `commentScope`.
- Produces: `replyRoute(deps)` for `POST /v1/issues/:number/comments` and `resolveRoute(deps)` for `POST /v1/issues/:number/resolve`, same `deps` shape as Task 5. Path regex `/^\/v1\/issues\/(\d{1,9})\/comments$/`. the handler re-parses the number from `new URL(req.url).pathname`.
  Reply: IP limit → authenticate → `getIssue`. absent or other reporter → 404 `not_found` → validate body → `consume(commentScope)` (429 + `Retry-After`) → `createComment(buildReplyBody(text))` → `upsertComment` with `postedForReporter: true` and `touchIssue` → `jsonOk({ commentId, createdAt }, 201)`. `GitHubError` → 502 `github_error` with a fixed message.
  Resolve: same prefix → issue `state === 'closed'` → 409 `conflict` → `consume(commentScope)` → `createComment('Closed as resolved by the reporter from Moss')` → `closeIssue` → `upsertComment` (`postedForReporter: true`), `upsertIssue` with `state 'closed'`, `stateReason 'completed'` → `jsonOk({ state: 'closed', closedAt })`.

- [ ] **Step 1: Write the failing tests**: reply on own open issue → 201, GitHub body equals `buildReplyBody(text)`, D1 comment has `posted_for_reporter = 1`. reply on a foreign issue → 404 and no GitHub call. whitespace text → 400. 61st comment in an hour → 429. resolve on open issue → GitHub comment then PATCH, D1 state closed. resolve on closed issue → 409 and no GitHub call. GitHub 500 on reply → 502 and no D1 row.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `cd workers/design-feedback && npm test && npm run typecheck`

- [ ] **Step 3: Commit**

```bash
git add workers/design-feedback/src workers/design-feedback/test/reply.test.ts workers/design-feedback/test/resolve.test.ts
git commit -m "feat(feedback-worker): reporter reply and resolve as the app with ownership checks"
```

---

### Task 7: Worker configuration and README for the webhook

**Files:**
- Modify: `workers/design-feedback/wrangler.toml` (secret comment lists `WEBHOOK_SECRET`)
- Modify: `workers/design-feedback/README.md`

- [ ] **Step 1: Document** in the README, after the deploy step. Add a repository webhook on each repository, not on the App: open the repository Settings, Webhooks, Add webhook. Payload URL is `<worker URL>/v1/webhook` (the production worker for `lightningrodlabs/moss`, the staging worker for `lightningrodlabs/moss-feedback-staging`). Content type is `application/json`. Generate a secret per repository. Select individual events: Issues and Issue comments. Then `npx wrangler secret put WEBHOOK_SECRET` (and `--env staging`) with the matching secret. Run `npm run migrate` and `npm run migrate:staging` again so `0002_comments.sql` applies. State that the App's own webhook stays off. Plain procedural English.

- [ ] **Step 2: Commit**

```bash
git add workers/design-feedback/wrangler.toml workers/design-feedback/README.md
git commit -m "docs(feedback-worker): webhook secret and setup for phase 2"
```

---

### Task 8: Local records gain threads. merge and unread logic

**Files:**
- Modify: `src/main/feedback/recordStore.ts`
- Create: `src/main/feedback/threadMerge.ts`
- Test: `src/main/feedback/recordStore.test.ts`, `src/main/feedback/threadMerge.test.ts`

**Interfaces:**
- Consumes: `FeedbackCommentWire`, `SyncIssue`, `unreadTeamComments` from `@theweave/utils` (Task 1).
- Produces:
  ```ts
  // recordStore.ts additions to FeedbackRecord
  comments?: FeedbackCommentWire[]. lastReadAt?: number. issueUpdatedAt?: number. stateReason?: string. title?: string;
  // threadMerge.ts
  export function mergeSyncIssue(record: FeedbackRecord, issue: SyncIssue): FeedbackRecord. // replaces matching comment ids, appends new, keeps others, sorts by createdAt, sets state/stateReason/title/issueUpdatedAt
  export function recordUnread(record: FeedbackRecordSummary): number. // unreadTeamComments(record.comments ?? [], record.lastReadAt)
  export function totalUnread(records: FeedbackRecordSummary[]): number;
  export function syncCursor(record: FeedbackRecord): { number: number. since: number } | undefined. // undefined without issueNumber. since = issueUpdatedAt ?? 0
  ```
  Legacy records without `comments` read as `[]` where needed. the store does not rewrite them.

- [ ] **Step 1: Write the failing tests**: merge replaces an edited comment by id and keeps order. a deleted comment stays in the list with `deleted: true` and is excluded from `recordUnread`. `totalUnread` sums across records. `syncCursor` undefined for a local-only record. the store round-trips the new fields.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `yarn vitest run src/main/feedback && yarn typecheck:node`

- [ ] **Step 3: Commit**

```bash
git add src/main/feedback/recordStore.ts src/main/feedback/threadMerge.ts src/main/feedback/recordStore.test.ts src/main/feedback/threadMerge.test.ts
git commit -m "feat(feedback): local records carry threads; merge and unread logic"
```

---

### Task 9: Worker client sync, reply and resolve

**Files:**
- Modify: `src/main/feedback/workerClient.ts`
- Test: `src/main/feedback/workerClient.test.ts`

**Interfaces:**
- Produces (same signing, timeout and failure mapping as `createIssue`. a shared private `signedPost(path, body)` replaces the inline code. 404 maps to `rejected`, 409 to a new reason `conflict`):
  ```ts
  export type WorkerFailureReason = ... | 'conflict';
  sync(req: SyncRequest): Promise<WorkerResult<SyncResponse>>.            // POST /v1/sync
  reply(issueNumber: number, req: ReplyRequest): Promise<WorkerResult<ReplyResponse>>.   // POST /v1/issues/:n/comments
  resolve(issueNumber: number): Promise<WorkerResult<ResolveResponse>>.  // POST /v1/issues/:n/resolve, empty JSON body `{}`
  ```

- [ ] **Step 1: Write the failing tests**: each method signs the exact path (verified with `verifySignedRequest` as in phase 1). 409 → `conflict`. response shape guard on `sync`.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `yarn vitest run src/main/feedback/workerClient && yarn typecheck:node`

- [ ] **Step 3: Commit**

```bash
git add src/main/feedback/workerClient.ts src/main/feedback/workerClient.test.ts
git commit -m "feat(feedback): worker client sync, reply and resolve"
```

---

### Task 10: Sync scheduler, IPC surface and wiring

**Files:**
- Create: `src/main/feedback/sync.ts`
- Modify: `src/main/feedback/ipc.ts`, `src/main/feedback/index.ts`
- Modify: `src/main/index.ts` (start the scheduler after `launch` succeeds. push `feedback-unread-changed`)
- Modify: `src/preload/admin.ts`, `src/renderer/src/electron-api.ts`
- Test: `src/main/feedback/sync.test.ts`, `src/main/feedback/ipc.test.ts`

**Interfaces:**
- Produces, in `sync.ts`:
  ```ts
  export type FeedbackSyncDeps = FeedbackIpcDeps & {
    scheduler: { setInterval(fn: () => void, ms: number): unknown. clearInterval(h: unknown): void };
    onUnreadChanged: (count: number) => void;
  };
  export const FEEDBACK_SYNC_INTERVAL_MS = 600_000;
  export async function syncOnce(deps: FeedbackSyncDeps): Promise<{ synced: number. unread: number } | { skipped: 'no-records' | 'no-key' | 'no-worker-url' | WorkerFailureReason }>;
  export function startFeedbackSync(deps: FeedbackSyncDeps): { stop(): void. syncNow(): Promise<void> };
  ```
  `syncOnce`: collect `syncCursor` for all records, newest 100. skip when empty. call `client.sync`. `mergeSyncIssue` and `store.update` per returned issue. compute `totalUnread`. call `onUnreadChanged` only when the count differs from the last emitted value. Concurrent calls coalesce (a second `syncNow` while one runs awaits the running one).
- Produces, in `ipc.ts`:
  ```ts
  export type FeedbackActionResult = { ok: true. record: FeedbackRecordSummary } | { ok: false. reason: 'no-key' | 'no-worker-url' | 'not-filed' | WorkerFailureReason };
  export type FeedbackSyncResult = { records: FeedbackRecordSummary[]. unread: number };
  // channels added: feedback-sync-now, feedback-reply (id, text), feedback-resolve (id), feedback-mark-read (id), feedback-unread-count
  ```
  `feedback-reply`: record must have `issueNumber` (`not-filed`), call `client.reply`, then `syncNow`, return the refreshed summary. `feedback-resolve`: same with `client.resolve`. `feedback-mark-read`: `store.update(id, { lastReadAt: now })`, recompute unread, emit if changed. Push event `feedback-unread-changed` with `number`. Preload bridges, mirrored in `electron-api.ts`: `syncFeedbackNow(): Promise<FeedbackSyncResult>`, `replyFeedback(id, text): Promise<FeedbackActionResult>`, `resolveFeedback(id): Promise<FeedbackActionResult>`, `markFeedbackRead(id): Promise<FeedbackRecordSummary | undefined>`, `getFeedbackUnreadCount(): Promise<number>`, `onFeedbackUnreadChanged(cb: (e: unknown, count: number) => void)`.
- `src/main/index.ts`: after `launch` succeeds, `startFeedbackSync({...deps, scheduler: { setInterval, clearInterval }, onUnreadChanged: (n) => emitToWindow(MAIN_WINDOW, 'feedback-unread-changed', n) })` once. `registerFeedbackIpc` gains the `syncNow` handle. Guard `MAIN_WINDOW` being destroyed as `audioSourcesIpc` does.

- [ ] **Step 1: Write the failing tests**: `syncOnce` skips with `no-records` for local-only records. merges and emits unread once for two identical results. interval registered with 600,000 ms. `feedback-reply` on a local-only record → `not-filed` without a client call. `feedback-mark-read` zeroes the record's unread and emits. the drift guard passes with the five new channels.

- [ ] **Step 2: Run to verify failure, implement, wire, run to verify pass**

Run: `yarn vitest run src/main/feedback src/main/ipc-contract-drift.test.ts && yarn typecheck:node`

- [ ] **Step 3: Commit**

```bash
git add src/main/feedback src/main/index.ts src/preload/admin.ts src/renderer/src/electron-api.ts
git commit -m "feat(feedback): poll the worker for thread updates and expose reply, resolve and unread over IPC"
```

---

### Task 11: Renderer thread components

**Files:**
- Create: `src/renderer/src/app/design-feedback/thread-view.ts` (pure helpers)
- Create: `src/renderer/src/app/design-feedback/feedback-settings.ts`
- Create: `src/renderer/src/app/design-feedback/feedback-history.ts`
- Create: `src/renderer/src/app/design-feedback/feedback-issue-card.ts`
- Modify: `src/renderer/src/self/settings/moss-settings.ts` (`renderFeedback` returns `<feedback-settings>`. the feedback state, loader and styles move out)
- Test: `src/renderer/src/app/design-feedback/thread-view.test.ts`

**Interfaces:**
- Consumes: `FeedbackRecordSummary`, `FeedbackActionResult`, `FeedbackSyncResult` mirrors (Task 10). `commentRole`, `unreadTeamComments` from `@theweave/utils`. `markdownParseSafe` from `src/renderer/src/utils.ts`.
- Produces, in `thread-view.ts`:
  ```ts
  export function imagesToLinks(markdown: string): string. // ![alt](url) -> [alt](url). alt empty -> [image](url)
  export function splitByState(records: FeedbackRecordSummary[]): { open: FeedbackRecordSummary[]. closed: FeedbackRecordSummary[] }. // local-only counts as open. newest first
  export function cardTitle(record: FeedbackRecordSummary): string. // record.title ?? first 60 chars of text
  ```
- Components:
  - `feedback-settings.ts`: the mode switch and reporter id line (moved verbatim), then `<feedback-history>`. Loads `listFeedback`, `getFeedbackReporterStatus` and calls `syncFeedbackNow` on first render. passes records down. listens to `onFeedbackUnreadChanged` to refresh.
  - `feedback-history.ts`: `sl-tab-group` with panels `msg('Open')` and `msg('Closed')`. each lists `<feedback-issue-card>` newest first. the Open tab label carries the unread badge (same `notification-dot` markup and CSS as `src/renderer/src/app/navigation/sidebar-button.ts`).
  - `feedback-issue-card.ts`: collapsed shows title, date, unread badge, `msg('View on GitHub')` link (for records with `issueUrl`) or the existing `msg('Copy')` button (local-only). Expanding calls `markFeedbackRead(id)` and shows the original text, the thread (each comment: author, date, body via `markdownParseSafe(imagesToLinks(body))`. role classes `team`, `reporter`, `other` with distinct left border colours. deleted comments show `msg('Comment deleted')` instead of a body), a reply `sl-textarea` with `maxlength` 10000 and a `msg('Send')` button, and for open issues a `msg('Mark resolved')` button wrapped in an `sl-tooltip` reading `msg('Closes the GitHub issue as completed. You cannot reopen it from Moss.')`. Buttons use `moss-button` classes. Notices: success `msg('Reply posted.')`, `msg('Issue marked resolved.')`. failure `msg('Could not reach the feedback service. Nothing was sent.')`. `conflict` → `msg('This issue is already closed.')`.

- [ ] **Step 1: Write the failing `thread-view` tests**: `imagesToLinks` converts with and without alt and leaves normal links alone. `splitByState` puts `local-only` under open and sorts newest first. `cardTitle` prefers the issue title.

- [ ] **Step 2: Run to verify failure, implement helpers, run to verify pass**

Run: `yarn vitest run src/renderer/src/app/design-feedback`

- [ ] **Step 3: Build the three components and rewire `moss-settings.ts`. `yarn typecheck:web`**

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/app/design-feedback src/renderer/src/self/settings/moss-settings.ts
git commit -m "feat(feedback): open and closed threads with reply and resolve in Settings"
```

---

### Task 12: Unread badges on the settings entry point

**Files:**
- Modify: `src/renderer/src/app/main-dashboard.ts` (cog button near line 1718. subscribe to `onFeedbackUnreadChanged` and read `getFeedbackUnreadCount` on connect)
- Modify: `src/renderer/src/self/settings/moss-settings.ts` (Feedback tab label badge)

- [ ] **Step 1: Add `@state() _feedbackUnread = 0` to `main-dashboard.ts`. render the `notification-dot` badge over the cog when above zero, matching the sidebar-button markup. the cog's `aria-label` already exists or is added**

- [ ] **Step 2: In `moss-settings.ts`, the Feedback tab label shows the same badge. the count comes from `getFeedbackUnreadCount` and the push event**

- [ ] **Step 3: `yarn typecheck:web`. commit**

```bash
git add src/renderer/src/app/main-dashboard.ts src/renderer/src/self/settings/moss-settings.ts
git commit -m "feat(feedback): unread badge on the settings icon and the Feedback tab"
```

---

### Task 13: Localization

**Files:**
- Modify: `src/renderer/xliff/*.xlf`, `src/renderer/src/locales/generated/*`

- [ ] **Step 1: `cd src/renderer && npx lit-localize extract`. translate every new unit in all eight files (German formal register). `npx lit-localize build`. `yarn typecheck:web`. `grep -c "<target/>\|<target></target>" src/renderer/xliff/*.xlf` all zero**

- [ ] **Step 2: Commit**

```bash
git add src/renderer/xliff src/renderer/src/locales/generated
git commit -m "i18n(feedback): translations for threads, reply and resolve"
```

---

### Task 14: Manual checklist and follow-ups

**Files:**
- Modify: `plans/feedback-phase1-manual-checklist.md` (rename to `plans/feedback-manual-checklist.md` and add a Phase 2 section)
- Modify: `docs/superpowers/plans/2026-11-10-feedback-phase1-followups.md` (strike items phase 2 fixed: `ON CONFLICT(number)`, D1 batch exists. add any new deferrals)

- [ ] **Step 1: Add the Phase 2 scenarios**: a team member comments on the staging issue → within 10 minutes, or on opening the tab, the card shows the comment with the team style and the badge shows 1 on the cog and the tab. expanding clears it. replying posts a `**Reporter** replied:` comment on GitHub and the card shows it with the reporter style. Mark resolved closes the issue on GitHub as completed and the card moves to Closed. a second Mark resolved attempt from a stale window shows "already closed". deleting the team comment on GitHub removes it after the next sync. a hand-filed issue on the staging repo with a pasted marker for this reporter appears after sync.

- [ ] **Step 2: Run the whole suite**: `yarn test:unit && yarn typecheck && (cd workers/design-feedback && npm test && npm run typecheck)`

- [ ] **Step 3: Commit**

```bash
git add plans docs/superpowers/plans/2026-11-10-feedback-phase1-followups.md
git commit -m "docs(feedback): manual checklist and follow-ups for phase 2"
```
