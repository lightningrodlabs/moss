# Feedback Phase 1: Secure Ingress and Reporter Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unauthenticated, personal-token feedback worker with a signed, GitHub App based ingress, and give every Moss profile a pseudonymous reporter id derived from its agent key.

**Architecture:** A dependency-free protocol module in `shared/utils/src/feedback/` defines the request types, limits, canonical signing string and issue body, and is imported by both the Electron main process and the Cloudflare worker. The main process gains a `src/main/feedback/` module that derives the reporter key through lair, stores local records, signs requests and owns the IPC surface; the renderer only calls IPC. The worker is rewritten into small modules (auth, rate limit, screenshot, GitHub App, D1) behind one `POST /v1/issues` route, tested with the Workers vitest pool.

**Tech Stack:** TypeScript, Electron 32 (Node 20 `node:crypto` Ed25519), Lit + Shoelace, Cloudflare Workers with D1, KV, R2, `@cloudflare/vitest-pool-workers`, GitHub REST API as a GitHub App.

**Spec:** `docs/superpowers/specs/2026-11-09-feedback-threads-design.md` (Phase 1 sections, Constraints, Testing).

**Branch:** `feat/feedback-phase1` off `main-0.7`.

## Global Constraints

- Signing domain string is exactly `moss-feedback-v1`; key derivation message is exactly `moss-feedback-key-v1`.
- Headers: `X-Moss-Reporter`, `X-Moss-Timestamp`, `X-Moss-Nonce`, `X-Moss-Signature`. All values base64url without padding except the timestamp (unix seconds, decimal).
- Canonical string: `moss-feedback-v1\n<METHOD>\n<path>\n<timestamp>\n<nonce>\n<base64url sha256(body)>`.
- Timestamp window 300 seconds. Nonce TTL 600 seconds.
- Limits: 10 issue creations per reporter per hour, 60 comments per reporter per hour, 30 requests per IP per minute, screenshot at most 2,097,152 decoded bytes, PNG signature required, text at most 10,000 characters.
- Reporter id is `base64url(sha256(reporterPubKey))` truncated to 12 characters.
- Issue body carries a visible line ``Reporter: `<id>` `` and the marker `<!-- moss-feedback reporter=<id> -->`.
- The shared feedback module imports nothing from Node, Workers, `@holochain/client` or any other package.
- The worker stays an npm package outside the yarn workspaces and imports the shared module by relative path.
- Repo owner and name, R2 public URL and GitHub App ids are wrangler vars; private key and webhook secret are wrangler secrets. No constants in worker source.
- The worker never logs headers, IPs or bodies.
- Every renderer string goes through `msg()` and gets translations in all eight target locales.
- Code comments explain intent, not the change. No `Co-Authored-By` trailers.
- Strong typing throughout; no `any` in new code.

## Review Focus

- Worker unreachable, timing out, or answering 5xx: the record is still saved locally and the user is told it was saved locally. Pinned in Task 5.
- A data URL whose media type is `image/png` but whose bytes are not a PNG, or a JPEG labelled as PNG: rejected with 400 and nothing written to R2. Pinned in Task 13.
- A client clock more than 300 seconds off: rejected with 401 and error code `stale_timestamp`, and the client maps that to a "check your system clock" message. Pinned in Tasks 5 and 11.
- Submitting before the profile has a group (no agent key, or lair not ready): `feedback-submit` resolves with `status: 'no-reporter-key'` rather than rejecting, and the record is saved locally. Pinned in Task 6.
- Text that is only whitespace, or longer than 10,000 characters: refused before any network call, on both sides. Pinned in Tasks 1 and 15.

---

### Task 1: Shared feedback protocol and signing module

**Files:**
- Create: `shared/utils/src/feedback/protocol.ts`
- Create: `shared/utils/src/feedback/signing.ts`
- Create: `shared/utils/src/feedback/index.ts`
- Modify: `shared/utils/src/index.ts` (add `export * from './feedback/index.js';`)
- Test: `shared/utils/src/feedback/protocol.test.ts`
- Test: `shared/utils/src/feedback/signing.test.ts`

**Interfaces:**
- Produces, in `protocol.ts`:
  ```ts
  export const FEEDBACK_LIMITS = {
    issuesPerReporterPerHour: 10,
    commentsPerReporterPerHour: 60,
    requestsPerIpPerMinute: 30,
    maxScreenshotBytes: 2_097_152,
    maxTextChars: 10_000,
    timestampWindowSeconds: 300,
    nonceTtlSeconds: 600,
  } as const;
  export type CreateIssueRequest = {
    text: string;
    screenshot: string; // data:image/png;base64,...
    mossVersion: string;
    os: string;
    githubHandle?: string;
  };
  export type CreateIssueResponse = { issueNumber: number; issueUrl: string };
  export type FeedbackErrorCode =
    | 'bad_request' | 'invalid_signature' | 'stale_timestamp' | 'replayed_nonce'
    | 'rate_limited' | 'screenshot_invalid' | 'screenshot_too_large' | 'text_too_long'
    | 'github_error' | 'not_found';
  export type FeedbackErrorResponse = { error: FeedbackErrorCode; message: string };
  export function validateCreateIssueRequest(req: unknown): CreateIssueRequest | FeedbackErrorResponse;
  ```
  `validateCreateIssueRequest` returns `bad_request` for a non-object or missing fields, `text_too_long` above the limit, `bad_request` for whitespace-only text, `screenshot_invalid` when `screenshot` does not match `/^data:image\/png;base64,[A-Za-z0-9+/=]+$/`, and `bad_request` for a `githubHandle` that is not `/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/`. Base64 string length above `ceil(maxScreenshotBytes/3)*4` is `screenshot_too_large`.
- Produces, in `signing.ts`:
  ```ts
  export const FEEDBACK_SIGNING_DOMAIN = 'moss-feedback-v1';
  export const FEEDBACK_HEADERS = {
    reporter: 'X-Moss-Reporter', timestamp: 'X-Moss-Timestamp',
    nonce: 'X-Moss-Nonce', signature: 'X-Moss-Signature',
  } as const;
  export function base64UrlEncode(bytes: Uint8Array): string;
  export function base64UrlDecode(s: string): Uint8Array;
  export function sha256(bytes: Uint8Array): Promise<Uint8Array>; // crypto.subtle.digest
  export function canonicalRequestString(p: {
    method: string; path: string; timestamp: number; nonce: string; bodySha256: Uint8Array;
  }): string;
  export function isTimestampFresh(timestamp: number, nowSeconds: number, windowSeconds?: number): boolean;
  export function reporterIdFromPubKey(pubKey: Uint8Array): Promise<string>;
  export type SignedHeaders = Record<(typeof FEEDBACK_HEADERS)[keyof typeof FEEDBACK_HEADERS], string>;
  export async function buildSignedHeaders(p: {
    method: string; path: string; body: Uint8Array; pubKey: Uint8Array; nonce: Uint8Array;
    nowSeconds: number; sign: (message: Uint8Array) => Promise<Uint8Array>;
  }): Promise<SignedHeaders>;
  export async function verifySignedRequest(p: {
    method: string; path: string; body: Uint8Array; headers: (name: string) => string | null;
    nowSeconds: number; verify: (pubKey: Uint8Array, message: Uint8Array, signature: Uint8Array) => Promise<boolean>;
  }): Promise<{ ok: true; pubKey: Uint8Array; nonce: string } | { ok: false; error: 'invalid_signature' | 'stale_timestamp' | 'bad_request' }>;
  ```
  `canonicalRequestString` upper-cases the method and joins with `\n`. `verifySignedRequest` returns `bad_request` for a missing header or a non-32-byte pubkey, `stale_timestamp` before checking the signature, and never checks nonces (the worker does that with KV).

- [ ] **Step 1: Write the failing protocol tests**

```ts
// protocol.test.ts
it('accepts a well formed request', () => {
  expect(validateCreateIssueRequest(valid)).toEqual(valid);
});
it('rejects whitespace-only text as bad_request', ...);
it('rejects text over 10000 chars as text_too_long', () => {
  expect((validateCreateIssueRequest({ ...valid, text: 'a'.repeat(10_001) }) as FeedbackErrorResponse).error).toBe('text_too_long');
});
it('rejects a jpeg data url as screenshot_invalid', ...);
it('rejects an oversize base64 payload as screenshot_too_large', ...);
it('rejects a github handle with a leading hyphen', ...);
it('exposes the spec limits', () => {
  expect(FEEDBACK_LIMITS.maxScreenshotBytes).toBe(2_097_152);
  expect(FEEDBACK_LIMITS.timestampWindowSeconds).toBe(300);
});
```

- [ ] **Step 2: Write the failing signing tests**

```ts
// signing.test.ts
it('canonical string matches the spec layout', async () => {
  const s = canonicalRequestString({ method: 'post', path: '/v1/issues', timestamp: 1700000000, nonce: 'abc', bodySha256: new Uint8Array(32) });
  expect(s).toBe(`moss-feedback-v1\nPOST\n/v1/issues\n1700000000\nabc\n${base64UrlEncode(new Uint8Array(32))}`);
});
it('base64url round trips without padding', ...);
it('timestamp window is 300 seconds inclusive', () => {
  expect(isTimestampFresh(1000, 1300)).toBe(true);
  expect(isTimestampFresh(1000, 1301)).toBe(false);
  expect(isTimestampFresh(1301, 1000)).toBe(false);
});
it('reporter id is 12 chars of base64url sha256', async () => {
  const id = await reporterIdFromPubKey(new Uint8Array(32).fill(7));
  expect(id).toHaveLength(12);
  expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
});
it('build then verify round trips with node ed25519', async () => {
  // generate an ed25519 keypair with node:crypto; sign = crypto.sign(null, msg, priv);
  // verify = crypto.verify(null, msg, pubKeyObject, sig)
  const headers = await buildSignedHeaders({ ..., nowSeconds: 1700000000 });
  const res = await verifySignedRequest({ ..., headers: (n) => headers[n] ?? null, nowSeconds: 1700000010, verify });
  expect(res.ok).toBe(true);
});
it('a tampered body fails verification', ...);
it('a timestamp 301s old is stale_timestamp before signature check', ...);
```
The test file may import `node:crypto`; the module under test may not.

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn vitest run shared/utils/src/feedback`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `protocol.ts`, `signing.ts`, `index.ts` and the re-export**

`sha256` uses `globalThis.crypto.subtle.digest('SHA-256', bytes)`. Raw 32-byte Ed25519 keys are passed through; conversion to platform key objects is the caller's job via the `sign`/`verify` callbacks.

- [ ] **Step 5: Run tests and typecheck**

Run: `yarn vitest run shared/utils/src/feedback && yarn workspace @theweave/utils build`
Expected: PASS; build emits `shared/utils/dist/feedback/`.

- [ ] **Step 6: Commit**

```bash
git add shared/utils/src/feedback shared/utils/src/index.ts
git commit -m "feat(feedback): shared protocol types, limits and request signing"
```

---

### Task 2: Shared issue body builder and marker parser

**Files:**
- Create: `shared/utils/src/feedback/issueBody.ts`
- Modify: `shared/utils/src/feedback/index.ts`
- Test: `shared/utils/src/feedback/issueBody.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type IssueBodyInput = {
    text: string; screenshotUrl: string; mossVersion: string; os: string;
    reporterId: string; githubHandle?: string;
  };
  export function buildIssueTitle(text: string): string; // `[Design Feedback] ` + first 57 chars + '...' when over 60
  export function buildIssueBody(input: IssueBodyInput): string;
  export function parseReporterMarker(body: string): string | undefined;
  export const REPORTER_MARKER_REGEX: RegExp; // /<!-- moss-feedback reporter=([A-Za-z0-9_-]{12}) -->/
  ```
  Body layout, in order: `## Design Feedback`, the text, `### Screenshot` with `![screenshot](url)`, `### Environment` with Moss version, OS, ``Reporter: `<id>` ``, and `GitHub: @handle` only when a handle is given, then `---`, `*Submitted via Moss Design Feedback Mode*`, then the HTML marker on its own last line.

- [ ] **Step 1: Write the failing tests**

```ts
it('includes reporter line and marker', () => {
  const body = buildIssueBody({ ...input, reporterId: 'abcDEF123_-x' });
  expect(body).toContain('Reporter: `abcDEF123_-x`');
  expect(body.trimEnd().endsWith('<!-- moss-feedback reporter=abcDEF123_-x -->')).toBe(true);
});
it('omits the GitHub line without a handle and includes it with one', ...);
it('parseReporterMarker finds the id and returns undefined when absent', ...);
it('title truncates over 60 chars with an ellipsis', ...);
```

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `yarn vitest run shared/utils/src/feedback/issueBody`

- [ ] **Step 3: Commit**

```bash
git add shared/utils/src/feedback
git commit -m "feat(feedback): shared issue body builder with reporter marker"
```

---

### Task 3: Reporter key derivation in the main process

**Files:**
- Create: `src/main/feedback/reporterKey.ts`
- Test: `src/main/feedback/reporterKey.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const REPORTER_KEY_DERIVATION_MESSAGE = 'moss-feedback-key-v1';
  export type AgentSigner = (message: Uint8Array) => Promise<Uint8Array>;
  export type ReporterKey = {
    publicKey: Uint8Array; // 32 bytes
    reporterId: string;
    sign: (message: Uint8Array) => Promise<Uint8Array>;
  };
  export async function deriveReporterKey(signWithAgentKey: AgentSigner): Promise<ReporterKey>;
  ```
  Seed is `sha256(signature of the UTF-8 derivation message)`. The Ed25519 private key is built with `crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' })` where the prefix is the 16 bytes `302e020100300506032b657004220420`. The public key is the last 32 bytes of the SPKI DER export. `sign` is `crypto.sign(null, message, privateKey)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('is deterministic for the same agent signature', async () => {
  const signer: AgentSigner = async () => new Uint8Array(64).fill(1);
  const a = await deriveReporterKey(signer); const b = await deriveReporterKey(signer);
  expect(a.publicKey).toEqual(b.publicKey); expect(a.reporterId).toBe(b.reporterId);
});
it('differs for a different agent signature', ...);
it('asks the agent signer for exactly the derivation message', async () => {
  const seen: Uint8Array[] = []; await deriveReporterKey(async (m) => { seen.push(m); return new Uint8Array(64); });
  expect(Buffer.from(seen[0]).toString('utf8')).toBe('moss-feedback-key-v1');
});
it('signatures verify against the exported public key', async () => {
  // crypto.verify(null, msg, createPublicKey({ key: spkiFromRaw(publicKey), format: 'der', type: 'spki' }), sig)
});
it('reporterId equals reporterIdFromPubKey(publicKey)', ...);
```

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `yarn vitest run src/main/feedback/reporterKey`

- [ ] **Step 3: Commit**

```bash
git add src/main/feedback/reporterKey.ts src/main/feedback/reporterKey.test.ts
git commit -m "feat(feedback): derive a reporter key from the agent key via lair"
```

---

### Task 4: Local feedback record store

**Files:**
- Create: `src/main/feedback/recordStore.ts`
- Test: `src/main/feedback/recordStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FeedbackRecord = {
    id: string; text: string; screenshot: string; mossVersion: string; os: string;
    timestamp: number; reporterId?: string; githubHandle?: string;
    issueNumber?: number; issueUrl?: string; state: 'open' | 'closed' | 'local-only';
    createdVia?: 'worker' | 'github';
  };
  export type FeedbackRecordSummary = Omit<FeedbackRecord, 'screenshot'>;
  export class FeedbackRecordStore {
    constructor(dir: string);
    save(record: Omit<FeedbackRecord, 'id'>): FeedbackRecord; // id = `${timestamp}-${6 random base36}`
    list(): FeedbackRecordSummary[];                            // newest first
    get(id: string): FeedbackRecord | undefined;
    update(id: string, patch: Partial<Omit<FeedbackRecord, 'id'>>): FeedbackRecord | undefined;
  }
  ```
  Files are `<dir>/<id>.json`, same layout the existing handlers write. A pre-existing file without `state` is read as `issueUrl ? 'open' : 'local-only'`, and an `issueNumber` is parsed from a trailing `/issues/<n>` in `issueUrl` when missing.

- [ ] **Step 1: Write the failing tests** using `fs.mkdtempSync` for `dir`

```ts
it('save then get round trips and list omits the screenshot', ...);
it('list is newest first', ...);
it('update merges a patch and persists it', ...);
it('a legacy record with issueUrl reads as open with its issue number parsed', () => {
  fs.writeFileSync(path.join(dir, '1-a.json'), JSON.stringify({ id: '1-a', text: 't', screenshot: '', mossVersion: '', os: '', timestamp: 1, issueUrl: 'https://github.com/o/r/issues/42' }));
  expect(store.get('1-a')).toMatchObject({ state: 'open', issueNumber: 42 });
});
it('get of an unknown id is undefined', ...);
```

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `yarn vitest run src/main/feedback/recordStore`

- [ ] **Step 3: Commit**

```bash
git add src/main/feedback/recordStore.ts src/main/feedback/recordStore.test.ts
git commit -m "feat(feedback): local record store with issue state"
```

---

### Task 5: Worker client in the main process

**Files:**
- Create: `src/main/feedback/workerClient.ts`
- Test: `src/main/feedback/workerClient.test.ts`

**Interfaces:**
- Consumes: `ReporterKey` (Task 3); `buildSignedHeaders`, `CreateIssueRequest`, `CreateIssueResponse`, `FeedbackErrorResponse` (Task 1).
- Produces:
  ```ts
  export type WorkerResult<T> =
    | { ok: true; value: T }
    | { ok: false; reason: 'unreachable' | 'stale_timestamp' | 'rate_limited' | 'rejected' | 'server_error'; status?: number; message?: string };
  export class FeedbackWorkerClient {
    constructor(baseUrl: string, key: ReporterKey, deps?: { fetch?: typeof fetch; now?: () => number; randomNonce?: () => Uint8Array; timeoutMs?: number });
    createIssue(req: CreateIssueRequest): Promise<WorkerResult<CreateIssueResponse>>;
  }
  ```
  Path signed is `/v1/issues`; body is `JSON.stringify(req)` as UTF-8; `Content-Type: application/json`. Default timeout 30,000 ms via `AbortSignal.timeout`. Mapping: network error or timeout is `unreachable`; 401 with body error `stale_timestamp` is `stale_timestamp`; 429 is `rate_limited`; other 4xx is `rejected`; 5xx is `server_error`.

- [ ] **Step 1: Write the failing tests** with a `vi.fn()` fetch

```ts
it('posts a signed request whose headers verify', async () => {
  // capture the Request, read headers, run verifySignedRequest with node verify against key.publicKey
});
it('returns ok with the parsed response on 200', ...);
it('maps a network error to unreachable', ...);
it('maps 401 stale_timestamp to stale_timestamp', ...);
it('maps 429 to rate_limited and 500 to server_error', ...);
```

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `yarn vitest run src/main/feedback/workerClient`

- [ ] **Step 3: Commit**

```bash
git add src/main/feedback/workerClient.ts src/main/feedback/workerClient.test.ts
git commit -m "feat(feedback): signed worker client with failure classification"
```

---

### Task 6: Feedback IPC surface and wiring

**Files:**
- Create: `src/main/feedback/ipc.ts`
- Create: `src/main/feedback/index.ts` (re-exports)
- Modify: `src/main/index.ts:1678-1724` (delete the five old handlers; call `registerFeedbackIpc`)
- Modify: `src/preload/admin.ts:197-209`
- Modify: `src/renderer/src/electron-api.ts:257-285`
- Modify: `src/main/mossConfig.ts` (add `feedbackWorkerUrl()` accessor honouring `MOSS_FEEDBACK_WORKER_URL`)
- Test: `src/main/feedback/ipc.test.ts`

**Interfaces:**
- Consumes: `FeedbackRecordStore` (Task 4), `FeedbackWorkerClient` (Task 5), `ReporterKey` (Task 3).
- Produces, in `ipc.ts`:
  ```ts
  export type FeedbackSubmitInput = {
    text: string; screenshot: string; mossVersion: string; os: string; githubHandle?: string;
    localOnly?: boolean; // Copy button: record only, never contact the worker
  };
  export type FeedbackSubmitResult =
    | { status: 'created'; record: FeedbackRecordSummary }
    | { status: 'saved-locally'; record: FeedbackRecordSummary; reason: 'local-only' | 'no-worker-url' | 'no-reporter-key' | 'unreachable' | 'stale_timestamp' | 'rate_limited' | 'rejected' | 'server_error' };
  export type FeedbackReporterStatus = { reporterId?: string };
  export type FeedbackIpcDeps = {
    store: FeedbackRecordStore;
    workerUrl: () => string | undefined;
    getReporterKey: () => Promise<ReporterKey | undefined>;
    makeClient?: (url: string, key: ReporterKey) => FeedbackWorkerClient;
  };
  export function feedbackSubmit(deps: FeedbackIpcDeps, input: FeedbackSubmitInput): Promise<FeedbackSubmitResult>;
  export function registerFeedbackIpc(ipc: { handle: typeof ipcMain.handle }, deps: FeedbackIpcDeps): void;
  ```
  Channels: `feedback-submit`, `feedback-list`, `feedback-get`, `feedback-reporter-status`. The old channels `get-feedback-worker-url`, `save-feedback`, `list-feedback`, `get-feedback`, `update-feedback-issue-url` are removed from both main and preload.
  `feedbackSubmit` always saves the record first with `state: 'local-only'` and `reporterId` when a key exists; with `localOnly` it returns `saved-locally` with reason `local-only` without touching the worker; on `created` it updates the record with `issueNumber`, `issueUrl`, `state: 'open'`, `createdVia: 'worker'`.
- `getReporterKey` in `src/main/index.ts` is a closure: returns `undefined` when `HOLOCHAIN_MANAGER` or `WE_RUST_HANDLER` is unset or `globalPubKeyFromListAppsResponse(await listApps())` is undefined; otherwise derives once and caches the `ReporterKey` for the process lifetime, with `signWithAgentKey = (m) => WE_RUST_HANDLER.signZomeCall(Array.from(m), Array.from(agentPubKey))` converted back to `Uint8Array`.
- Preload bridges: `submitFeedback(input: FeedbackSubmitInput)`, `listFeedback()`, `getFeedback(id)`, `getFeedbackReporterStatus()`; `electron-api.ts` types import `FeedbackSubmitInput`, `FeedbackSubmitResult`, `FeedbackReporterStatus`, `FeedbackRecord`, `FeedbackRecordSummary` from `../../main/feedback/ipc` style type-only paths as the file already does for other main types (check an existing import at the top of `electron-api.ts` and match it).

- [ ] **Step 1: Write the failing tests** for `feedbackSubmit` with a temp-dir store and a fake client

```ts
it('saves locally with reason no-reporter-key when there is no key', async () => {
  const res = await feedbackSubmit({ store, workerUrl: () => 'https://w', getReporterKey: async () => undefined }, input);
  expect(res.status).toBe('saved-locally'); expect(res.reason).toBe('no-reporter-key');
  expect(store.list()[0].state).toBe('local-only');
});
it('saves locally with reason no-worker-url when url is empty', ...);
it('localOnly saves the record and never calls the client', ...);
it('marks the record open with issue number and url on success', ...);
it('passes the client failure reason through and keeps the record local-only', ...);
it('registers exactly the four channels', () => {
  const handle = vi.fn(); registerFeedbackIpc({ handle }, deps);
  expect(handle.mock.calls.map((c) => c[0]).sort()).toEqual(['feedback-get', 'feedback-list', 'feedback-reporter-status', 'feedback-submit']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn vitest run src/main/feedback/ipc`

- [ ] **Step 3: Implement `ipc.ts`, wire `index.ts`, update preload and `electron-api.ts`, add the config accessor**

Delete the old handlers and the `getFeedbackWorkerUrl` bridge. Add `MOSS_FEEDBACK_WORKER_URL` env override in `mossConfig.ts` as `export function feedbackWorkerUrl(): string | undefined` (env first, then `MOSS_CONFIG.feedbackWorkerUrl`, empty string is undefined). This env override is the plan's way to point a dev build at staging.

- [ ] **Step 4: Run the feedback tests, the IPC drift guard and the node typecheck**

Run: `yarn vitest run src/main/feedback src/main/ipc-contract-drift.test.ts && yarn typecheck:node`
Expected: PASS. The drift test confirms no orphaned or dead channels. `typecheck:web` will fail until Task 7 updates the renderer callers; that is expected here.

- [ ] **Step 5: Commit**

```bash
git add src/main/feedback src/main/index.ts src/main/mossConfig.ts src/preload/admin.ts src/renderer/src/electron-api.ts
git commit -m "feat(feedback): move submission into the main process behind signed IPC"
```

---

### Task 7: Renderer submits through IPC, GitHub handle field, disclaimer

**Files:**
- Modify: `src/renderer/src/app/design-feedback/design-feedback-controller.ts` (`_onFeedbackSubmitted`, `_onFeedbackCopied`)
- Modify: `src/renderer/src/app/design-feedback/feedback-dialog.ts` (handle input, disclaimer, event detail)
- Modify: `src/renderer/src/persisted-store.ts` (add `feedbackGithubHandle: SubStore<string, string, []>`, key `feedbackGithubHandle`, default `''`)
- Create: `src/renderer/src/app/design-feedback/submit-result.ts`
- Test: `src/renderer/src/app/design-feedback/submit-result.test.ts`

**Interfaces:**
- Consumes: `window.electronAPI.submitFeedback`, `FeedbackSubmitResult` (Task 6).
- Produces:
  ```ts
  // submit-result.ts
  export type SubmitNotice = 'created' | 'saved-locally' | 'saved-locally-no-group' | 'saved-locally-clock' | 'saved-locally-rate-limited';
  export function noticeForResult(result: FeedbackSubmitResult): SubmitNotice;
  ```
  Mapping: `created` is `created`; `no-reporter-key` is `saved-locally-no-group`; `stale_timestamp` is `saved-locally-clock`; `rate_limited` is `saved-locally-rate-limited`; everything else is `saved-locally`. The controller maps each notice to one `msg()` string:
  - created: `Feedback submitted. GitHub issue created.`
  - saved-locally: `Feedback saved locally. Could not reach the feedback service.`
  - saved-locally-no-group: `Feedback saved locally. Join or create a group to enable submitting feedback.`
  - saved-locally-clock: `Feedback saved locally. Your system clock seems to be off; please check it and try again.`
  - saved-locally-rate-limited: `Feedback saved locally. You have submitted a lot recently; please try again later.`
- The dialog's `feedback-submitted` and `feedback-copied` event detail gains `githubHandle: string` (empty when blank). The dialog shows an `sl-input` labelled `GitHub username (optional)` with help text `Not verified. Lets the team mention you on the issue.`, prefilled from `PersistedStore.feedbackGithubHandle`, saved back on submit. Validation mirrors the handle regex from Task 1; an invalid handle disables Submit and shows the input's error state.
- Disclaimer gains the sentence: `A pseudonymous reporter id, the same for every issue from this Moss profile, is included so the team can follow up. It cannot be traced back to you or your groups.`
- The controller calls `submitFeedback(input)` for Submit and `submitFeedback({ ...input, localOnly: true })` for Copy, so the Copy path records locally without any network call and no extra IPC channel exists.

- [ ] **Step 1: Write the failing `submit-result` tests** covering every mapping line above.

- [ ] **Step 2: Run to verify failure, implement `submit-result.ts`, run to verify pass**

Run: `yarn vitest run src/renderer/src/app/design-feedback`

- [ ] **Step 3: Update controller, dialog and persisted store as specified**

- [ ] **Step 4: Typecheck**

Run: `yarn typecheck`
Expected: PASS for both node and web.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/app/design-feedback src/renderer/src/persisted-store.ts
git commit -m "feat(feedback): submit via main process, optional GitHub handle, reporter id disclaimer"
```

---

### Task 8: Settings switch gated on reporter key

**Files:**
- Modify: `src/renderer/src/self/settings/moss-settings.ts` (`renderFeedback`, `_loadFeedbackHistory`, the `FeedbackRecord` local type)

**Interfaces:**
- Consumes: `window.electronAPI.getFeedbackReporterStatus()`, `listFeedback()` returning `FeedbackRecordSummary[]` (Task 6).

- [ ] **Step 1: Replace the local `FeedbackRecord` type with the imported `FeedbackRecordSummary`; on tab open also call `getFeedbackReporterStatus()` into `@state() _reporterId?: string`**

- [ ] **Step 2: Disable the `sl-switch` when `_reporterId` is undefined and show help text `Feedback becomes available after you join or create a group.` under it. When defined, show `Reporter id: <id>` in the same muted style as `.feedback-date` with an `sl-tooltip` reading `A pseudonymous id included on your issues so the team can follow up.`**

- [ ] **Step 3: Typecheck and run the app once in dev to see the switch disabled on a fresh profile and enabled after creating a group**

Run: `yarn typecheck:web`
Manual: `yarn tool-dev-example-1`, open Settings, Feedback tab, before and after creating a group.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/self/settings/moss-settings.ts
git commit -m "feat(feedback): gate feedback mode on a reporter key and show the reporter id"
```

---

### Task 9: Localization of the new strings

**Files:**
- Modify: `src/renderer/xliff/{de,fr,es,tr,it,pt,ja,nl}.xlf`
- Modify: `src/renderer/src/locales/generated/*` (generated)

- [ ] **Step 1: Extract**

Run: `cd src/renderer && npx lit-localize extract`
Expected: new `<trans-unit>` entries with empty targets for every string added in Tasks 7 and 8; the old `Feedback saved locally. Could not create GitHub issue.` and `Feedback saved locally. Could not reach server.` units become obsolete.

- [ ] **Step 2: Add translations for every new unit in all eight files**

- [ ] **Step 3: Build and typecheck**

Run: `cd src/renderer && npx lit-localize build && cd ../.. && yarn typecheck:web`
Expected: PASS, no empty targets reported.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/xliff src/renderer/src/locales/generated
git commit -m "i18n(feedback): translations for submission notices, handle field and reporter id"
```

---

### Task 10: Worker scaffolding, bindings, migration and test harness

**Files:**
- Modify: `workers/design-feedback/wrangler.toml`
- Modify: `workers/design-feedback/package.json`
- Create: `workers/design-feedback/tsconfig.json`
- Create: `workers/design-feedback/vitest.config.ts`
- Create: `workers/design-feedback/migrations/0001_reporters_issues.sql`
- Create: `workers/design-feedback/src/env.ts`
- Create: `workers/design-feedback/src/router.ts`
- Rewrite: `workers/design-feedback/src/index.ts`
- Create: `workers/design-feedback/.gitignore` (`node_modules`, `.wrangler`)
- Test: `workers/design-feedback/test/router.test.ts`

**Interfaces:**
- Produces, in `env.ts`:
  ```ts
  export interface Env {
    FEEDBACK_DB: D1Database; FEEDBACK_KV: KVNamespace; FEEDBACK_BUCKET: R2Bucket;
    GITHUB_REPO_OWNER: string; GITHUB_REPO_NAME: string; R2_PUBLIC_URL: string;
    GITHUB_APP_ID: string; GITHUB_INSTALLATION_ID: string; GITHUB_APP_PRIVATE_KEY: string;
  }
  ```
- Produces, in `router.ts`:
  ```ts
  export type Handler = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
  export function jsonError(status: number, error: FeedbackErrorCode, message: string): Response;
  export function jsonOk(body: unknown, status?: number): Response;
  export function route(req: Request, routes: Array<{ method: string; path: RegExp; handler: Handler }>, env: Env, ctx: ExecutionContext): Promise<Response>;
  ```
  Unknown path or method is `jsonError(404, 'not_found', ...)`. No CORS headers anywhere; the caller is the Electron main process, not a browser.
- `wrangler.toml`: `name = "moss-design-feedback"`, `compatibility_date = "2025-10-01"`, `compatibility_flags = ["nodejs_compat"]`, bindings `FEEDBACK_DB` (d1), `FEEDBACK_KV` (kv), `FEEDBACK_BUCKET` (r2 `moss-feedback-images`), `[vars]` with the five string vars for production (`lightningrodlabs`, `moss`, the existing R2 public URL, app id and installation id placeholders), and `[env.staging]` overriding `name = "moss-design-feedback-staging"`, `GITHUB_REPO_NAME = "moss-feedback-staging"`, its own D1, KV and R2 (`moss-feedback-images-staging`) ids. Secrets listed in a comment: `GITHUB_APP_PRIVATE_KEY`.
- `package.json` devDependencies: `wrangler@^3.114`, `vitest@~2.1`, `@cloudflare/vitest-pool-workers@^0.5`, `@cloudflare/workers-types@^4`, `typescript@^5`. Scripts: `dev`, `deploy`, `deploy:staging` (`wrangler deploy --env staging`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`), `migrate` (`wrangler d1 migrations apply FEEDBACK_DB`), `migrate:staging`.
- `tsconfig.json`: `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `strict`, `types: ["@cloudflare/workers-types"]`, `include: ["src", "test", "../../shared/utils/src/feedback"]`.
- `vitest.config.ts` uses `defineWorkersConfig` with `wrangler: { configPath: './wrangler.toml' }` and `miniflare: { d1Databases: ['FEEDBACK_DB'], kvNamespaces: ['FEEDBACK_KV'], r2Buckets: ['FEEDBACK_BUCKET'], bindings: { GITHUB_REPO_OWNER: 'o', GITHUB_REPO_NAME: 'r', R2_PUBLIC_URL: 'https://r2.test', GITHUB_APP_ID: '1', GITHUB_INSTALLATION_ID: '2', GITHUB_APP_PRIVATE_KEY: '<test RSA PEM generated in setup>' } }` and a `test/setup.ts` that applies the migration SQL to the D1 binding before each file.
- Migration:
  ```sql
  CREATE TABLE reporters (reporter_id TEXT PRIMARY KEY, pubkey BLOB NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE issues (number INTEGER PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES reporters(reporter_id),
    state TEXT NOT NULL, state_reason TEXT, title TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, created_via TEXT NOT NULL);
  CREATE INDEX issues_reporter ON issues(reporter_id);
  ```

- [ ] **Step 1: Write the failing router test**

```ts
import { SELF } from 'cloudflare:test';
it('unknown route is a 404 json error', async () => {
  const res = await SELF.fetch('https://w/nope'); expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found', message: expect.any(String) });
});
it('old /feedback route is gone', async () => {
  const res = await SELF.fetch('https://w/feedback', { method: 'POST' }); expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Install, run to verify failure**

Run: `cd workers/design-feedback && npm install && npm test`

- [ ] **Step 3: Implement env, router, index, wrangler, tsconfig, vitest config, setup and migration**

- [ ] **Step 4: Run tests and typecheck**

Run: `cd workers/design-feedback && npm test && npm run typecheck`
Expected: PASS; the relative import of `../../../shared/utils/src/feedback/index.ts` compiles.

- [ ] **Step 5: Commit**

```bash
git add workers/design-feedback
git commit -m "feat(feedback-worker): scaffold v1 worker with D1, KV, R2 bindings and test harness"
```

---

### Task 11: Worker request authentication

**Files:**
- Create: `workers/design-feedback/src/auth.ts`
- Test: `workers/design-feedback/test/auth.test.ts`

**Interfaces:**
- Consumes: `verifySignedRequest`, `reporterIdFromPubKey`, `FEEDBACK_LIMITS` (Task 1).
- Produces:
  ```ts
  export type Authed = { pubKey: Uint8Array; reporterId: string; body: Uint8Array };
  export async function authenticate(req: Request, env: Env, now?: () => number): Promise<Authed | Response>;
  export async function verifyEd25519(pubKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean>; // crypto.subtle importKey('raw', ..., { name: 'Ed25519' })
  ```
  Order: read body bytes; `verifySignedRequest`; on `stale_timestamp` return `jsonError(401, 'stale_timestamp', ...)`; on `invalid_signature` 401; on `bad_request` 400; then nonce check `FEEDBACK_KV.get('nonce:' + nonce)`, replay is `jsonError(401, 'replayed_nonce', ...)`, otherwise `put` with `expirationTtl: 600`.

- [ ] **Step 1: Write the failing tests** using a test helper `test/sign.ts` that generates an Ed25519 key with `crypto.subtle.generateKey` and builds headers via `buildSignedHeaders`

```ts
it('accepts a fresh signed request and returns the reporter id', ...);
it('rejects a 301 second old timestamp with 401 stale_timestamp', ...);
it('rejects a replayed nonce with 401 replayed_nonce', ...);
it('rejects a tampered body with 401 invalid_signature', ...);
it('rejects missing headers with 400 bad_request', ...);
```

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `cd workers/design-feedback && npm test -- auth`

- [ ] **Step 3: Commit**

```bash
git add workers/design-feedback/src/auth.ts workers/design-feedback/test
git commit -m "feat(feedback-worker): verify reporter signatures with replay protection"
```

---

### Task 12: Worker rate limiting

**Files:**
- Create: `workers/design-feedback/src/rateLimit.ts`
- Test: `workers/design-feedback/test/rateLimit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RateScope = { key: string; limit: number; windowSeconds: number };
  export function ipScope(req: Request): RateScope;            // 'ip:' + CF-Connecting-IP, 30 per 60s
  export function issueScope(reporterId: string): RateScope;   // 'issues:' + id, 10 per 3600s
  export function commentScope(reporterId: string): RateScope; // 'comments:' + id, 60 per 3600s
  export async function consume(kv: KVNamespace, scope: RateScope, now?: () => number): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  ```
  Fixed window keyed `${scope.key}:${Math.floor(now / windowSeconds)}` with the count as the value and `expirationTtl: windowSeconds * 2`. Denial response elsewhere is `jsonError(429, 'rate_limited', ...)` with a `Retry-After` header.

- [ ] **Step 1: Write the failing tests**: the 10th call allowed and the 11th denied for `issueScope`; a new window resets; `retryAfterSeconds` is the time to the window end.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `cd workers/design-feedback && npm test -- rateLimit`

- [ ] **Step 3: Commit**

```bash
git add workers/design-feedback/src/rateLimit.ts workers/design-feedback/test/rateLimit.test.ts
git commit -m "feat(feedback-worker): per-reporter and per-IP fixed window rate limits"
```

---

### Task 13: Screenshot validation and R2 upload

**Files:**
- Create: `workers/design-feedback/src/screenshot.ts`
- Test: `workers/design-feedback/test/screenshot.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function decodePngDataUrl(dataUrl: string): Uint8Array | 'screenshot_invalid' | 'screenshot_too_large';
  export async function storeScreenshot(bucket: R2Bucket, publicUrl: string, bytes: Uint8Array, now?: () => number): Promise<string>; // returns public URL
  ```
  `decodePngDataUrl` rejects anything not matching the Task 1 regex, decodes, rejects when the first 8 bytes are not `89 50 4E 47 0D 0A 1A 0A`, rejects when length exceeds `FEEDBACK_LIMITS.maxScreenshotBytes`. Object key `feedback/<unix ms>-<6 random base36>.png`, `contentType: image/png`.

- [ ] **Step 1: Write the failing tests**: a minimal valid PNG header passes; JPEG magic bytes with a `image/png` label is `screenshot_invalid`; a `image/jpeg` data URL is `screenshot_invalid`; a payload of 2,097,153 bytes is `screenshot_too_large`; `storeScreenshot` puts an object readable back from the test R2 binding with the returned URL ending in `.png`.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `cd workers/design-feedback && npm test -- screenshot`

- [ ] **Step 3: Commit**

```bash
git add workers/design-feedback/src/screenshot.ts workers/design-feedback/test/screenshot.test.ts
git commit -m "feat(feedback-worker): validate PNG screenshots before storing in R2"
```

---

### Task 14: GitHub App authentication and issue creation

**Files:**
- Create: `workers/design-feedback/src/github.ts`
- Test: `workers/design-feedback/test/github.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function appJwt(appId: string, privateKeyPem: string, now?: () => number): Promise<string>; // RS256, iat now-60, exp now+540
  export async function installationToken(env: Env, fetchImpl?: typeof fetch, now?: () => number): Promise<string>; // module-level cache until 5 minutes before expiry
  export type CreatedIssue = { number: number; html_url: string; title: string; created_at: string };
  export async function createIssue(env: Env, p: { title: string; body: string; labels: string[] }, fetchImpl?: typeof fetch): Promise<CreatedIssue>; // throws GitHubError with status on non-2xx
  export class GitHubError extends Error { constructor(public status: number, message: string); }
  ```
  Requests carry `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: moss-feedback-worker`. Label is `design-feedback`. The PEM is imported with `crypto.subtle.importKey('pkcs8', ..., { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' })`; PKCS#1 `BEGIN RSA PRIVATE KEY` PEMs are converted to PKCS#8 by wrapping, since GitHub downloads PKCS#1.

- [ ] **Step 1: Write the failing tests** using `fetchMock` from `cloudflare:test` for `api.github.com`: the JWT has three segments and its payload decodes to the right `iss`, `iat`, `exp`; `installationToken` posts to `/app/installations/2/access_tokens` once for two calls; `createIssue` posts to `/repos/o/r/issues` with the label and returns the parsed issue; a 403 from GitHub throws `GitHubError` with status 403.

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `cd workers/design-feedback && npm test -- github`

- [ ] **Step 3: Commit**

```bash
git add workers/design-feedback/src/github.ts workers/design-feedback/test/github.test.ts
git commit -m "feat(feedback-worker): act on GitHub as an installed GitHub App"
```

---

### Task 15: `POST /v1/issues` route and D1 persistence

**Files:**
- Create: `workers/design-feedback/src/db.ts`
- Create: `workers/design-feedback/src/routes/createIssue.ts`
- Modify: `workers/design-feedback/src/index.ts` (register the route)
- Test: `workers/design-feedback/test/createIssue.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 11, 12, 13, 14.
- Produces, in `db.ts`:
  ```ts
  export async function upsertReporter(db: D1Database, reporterId: string, pubKey: Uint8Array, now: number): Promise<void>;
  export async function insertIssue(db: D1Database, row: { number: number; reporterId: string; title: string; createdAt: number; createdVia: 'worker' | 'github' }): Promise<void>; // state 'open'
  ```
- Route order inside `createIssue`: IP rate limit; `authenticate`; parse JSON and `validateCreateIssueRequest` (400 with the returned error code); issue rate limit for the reporter; `decodePngDataUrl` (400 with its code); `storeScreenshot`; `buildIssueTitle` and `buildIssueBody` with the reporter id and optional handle; `createIssue`; `upsertReporter` and `insertIssue`; respond `jsonOk({ issueNumber, issueUrl }, 201)`. A `GitHubError` is `jsonError(502, 'github_error', ...)` and the stored screenshot is deleted from R2 in that case.

- [ ] **Step 1: Write the failing tests** through `SELF.fetch` with signed requests and `fetchMock` for GitHub

```ts
it('creates an issue, stores the screenshot, and records reporter and issue in D1', async () => {
  // assert 201 body, R2 has one object, D1 issues row has state 'open' and created_via 'worker',
  // and the GitHub request body contains the reporter marker and the handle line
});
it('unsigned request is 401 and nothing is stored', ...);
it('whitespace text is 400 bad_request and nothing is stored', ...);
it('eleventh issue in an hour is 429 with Retry-After', ...);
it('GitHub 500 yields 502 github_error and the screenshot is removed', ...);
```

- [ ] **Step 2: Run to verify failure, implement, run to verify pass**

Run: `cd workers/design-feedback && npm test`

- [ ] **Step 3: Commit**

```bash
git add workers/design-feedback/src
git add workers/design-feedback/test/createIssue.test.ts
git commit -m "feat(feedback-worker): signed POST /v1/issues creating issues as the app"
```

---

### Task 16: CI job, worker README, provisioning checklist

**Files:**
- Modify: `.github/workflows/test.yaml` (new job `feedback-worker-tests`)
- Create: `workers/design-feedback/README.md`
- Create: `plans/feedback-phase1-manual-checklist.md`

- [ ] **Step 1: Add the CI job**: ubuntu-22.04, `actions/setup-node@v4` with node 22, `npm ci` and `npm test` and `npm run typecheck` with `working-directory: workers/design-feedback`.

- [ ] **Step 2: Write the README** covering, in order: create the GitHub App on the `lightningrodlabs` org (permissions Issues read/write, Metadata read, Device Flow enabled, webhook off for now), install it on `moss` and `moss-feedback-staging`, note the app id and installation id, download the private key; create D1, KV and R2 for production and staging with `wrangler d1 create`, `wrangler kv namespace create`, `wrangler r2 bucket create` and paste the ids into `wrangler.toml`; `npm run migrate` and `migrate:staging`; `wrangler secret put GITHUB_APP_PRIVATE_KEY` for each env; deploy; point a dev Moss at staging with `MOSS_FEEDBACK_WORKER_URL`. State that the previous personal access token must be revoked if it still exists.

- [ ] **Step 3: Write the manual checklist**: fresh profile shows the switch disabled; after creating a group the switch enables and the reporter id appears; submitting against staging creates an issue on `moss-feedback-staging` whose body shows the reporter line and marker, and the history row shows "View Issue"; a second profile gets a different reporter id; stopping the staging worker and submitting gives the "could not reach" notice with a local record; setting the system clock 10 minutes ahead gives the clock notice.

- [ ] **Step 4: Run the whole unit suite and both typechecks**

Run: `yarn test:unit && yarn typecheck && (cd workers/design-feedback && npm test && npm run typecheck)`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/test.yaml workers/design-feedback/README.md plans/feedback-phase1-manual-checklist.md
git commit -m "ci(feedback-worker): run worker tests; document provisioning and manual checks"
```
