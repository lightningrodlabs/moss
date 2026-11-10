# Feedback phase 1: open follow-ups

Written for the builder of phase 2. These items came out of the per-task and
whole-branch reviews of phase 1 and were deferred on purpose. None of them
blocks the 0.16 release. Items that the reviews rated "fix before merge"
were fixed on the branch and are not listed here.

## Worker

- A chunked request body with no `Content-Length` header is buffered in full
  before the size check in `auth.ts`. A streaming byte counter can stop the
  read at `FEEDBACK_LIMITS.maxRequestBytes`.
- `createIssue.ts` rebuilds the R2 key from the public URL. If
  `R2_PUBLIC_URL` ever carries a path prefix, the derived key is wrong and the
  delete on a GitHub error silently misses. Return `{ key, url }` from
  `storeScreenshot` instead.
- A `fetch` failure in `github.ts` is not wrapped as `GitHubError`, so it
  surfaces as a 500 and leaves the screenshot in R2.
- ~~`insertIssue` has no `ON CONFLICT(number)` clause.~~ Fixed in phase 2.
- Raw client IPs are KV keys for up to 120 seconds. Hashing them matches
  the spec anti-goal about IPs more closely.
- The test named "unsigned request is 401" in `createIssue.test.ts` tests a
  tampered signature. Rename it.
- `route()` dispatch has no direct test for a known path with the wrong
  method.
- `@cloudflare/vitest-pool-workers` is deprecated in favour of
  `@cloudflare/vitest-plugin`. Run the official codemod once the
  plugin has a release older than two weeks.
- The signing domain string does not include the environment. A request
  captured for staging can be replayed against production inside the
  300 second window, because the two have separate nonce stores.
- The KV read-then-write in `rateLimit.ts` is not atomic, and a corrupted
  counter value fails closed until its TTL expires.

## Main process

- When the stored reporter seed cannot be decrypted, or the seed file is
  empty after a crash, `getReporterKey` throws and `ipc.ts` treats that as
  "no key". Settings then shows "The feedback key could not be loaded." and
  submits save locally with the same message. The user has no way to recover.
  Move the bad file aside and generate a new seed.
- On Linux, Electron `safeStorage` can report encryption as available while
  using the `basic_text` backend with a fixed key. The `enc: 'safeStorage'`
  label in `reporter-seed.json` overstates the protection there. Check
  `getSelectedStorageBackend()` and record `plain` in that case.
- A plain seed is never re-encrypted once a keyring becomes available.
- `recordStore.list()` has no tie-break for equal timestamps and no shape
  check after `JSON.parse`.
- A `created` result whose `store.update` failed carries a record without an
  issue number. Phase 2 sync cannot see it. A hand-pasted marker on the issue
  recovers it through the webhook.
- `tsconfig.node.json` includes `src/main/*` only, so `src/main/feedback/`
  and `src/main/asr/` tests are never typechecked. Add `src/main/**/*`.
- The main process uses Node `fetch`, which ignores the system proxy. The old
  renderer path used Chromium networking. Consider Electron `net.fetch`.

## Renderer

- The GitHub handle regex and the PNG data URL regex are duplicated from
  `shared/utils/src/feedback/protocol.ts` because the shared module does not
  export them. Export both and import them.
- A handle typed with a leading `@` is rejected. Strip one leading `@`.
- The spec places the GitHub handle field in the dialog and in Settings.
  Only the dialog has it.
- The oversize screenshot help line, the disabled Submit state and the
  handle error state were not measured in the running app (CLAUDE.md
  rule 7). The manual checklist covers them.
- Translation word choices for native speakers to check: es
  "informante", ja 匿名 for "pseudonymous", tr "sorunlar" for "issues".
  Older German units mix formal and informal register.

## Docs and process

- The phase 1 plan still describes the lair based key derivation. The spec
  and the handoff carry the current design.
- `README.md` for the worker: `wrangler kv namespace create` can offer to
  write the binding into the configuration file. Decline and copy the id.
- Root `yarn test:unit` shows two `lanBeacon` UDP failures inside the
  sandbox used for this work. They also fail on the untouched base there and
  pass where UDP loopback is allowed.

# Phase 2 deferrals

D1 writes were already batched in phase 2, so no item is open for that.
These items came out of the phase 2 task reviews.

## Worker

- Sync backfill of comments stops at 100 per issue. Add pagination.
- A missing `created_at` on a backfilled comment falls back to 0.
- An unset `WEBHOOK_SECRET` fails closed with a 500. Return an explicit
  error code.
- Webhook signature hex is accepted in lowercase only.
- Issues that GitHub `transferred` keep being mirrored.
- The webhook size cap duplicates the one in `auth.ts`. Share a helper.
- An edit echo for a comment that is already deleted can undelete it.
  Skip the upsert for deleted comments.
- `softDeleteComment` can move `updated_at` backwards under clock skew.
- A comment with `user: null` is rejected. `isRawComment` is typed as
  `GitHubComment` but accepts null. Use a raw type.
- The resolve batch writes back the title read at the start of the request
  and an `updated_at` without `MAX`. A webhook race can revert a title edit.
- A resolve against stale D1 posts a duplicate resolve note.
- `createIssue.ts` keeps helpers that duplicate the ones in the new routes.
- `Number.isInteger` in the validators accepts unsafe integers. Use
  `Number.isSafeInteger`. Duplicate issue numbers in a sync request are not
  rejected. A lone `\r` is not split in `buildReplyBody`.
- Test gaps: reopened and edited-title webhooks, the PR filter, a 413 by
  `Content-Length`, a 409 that leaves the KV counter untouched, a resolve
  429, a 502 message without GitHub text, a failed comment POST, a non-2xx
  from `closeIssue`, `getIssue` and `listIssueComments`, and a NULL
  `stateReason`.

## Main process

- Mark-read uses the local clock. Use the larger of now and the newest
  comment `createdAt`.
- The OS notification follows the net change in unread count, so a read and
  a new comment in one sync can cancel out.
- Sync state is keyed by a `WeakMap`. A `createFeedbackSync(deps)` owner
  object is more explicit.
- A click on the OS notification before the window exists can lose the
  `open-feedback-settings` message. Check the cold start path.
- No reference is kept to the `Notification` object. This matches the
  existing pattern.
- No test shows that `lastReadAt` survives a merge or that an empty comment
  list still advances `issueUpdatedAt`. An unused `_previousReason` is
  destructured.
- `isWireComment` returns a boolean, not a type predicate.

## Renderer

- Badge CSS is repeated in the card, the history view and the tab. Extract a
  badge element.
- The tab badge right offset can clip. Measure it.
- The history view can race between the unread reload, `syncFeedbackNow`
  and `feedback-changed`. It corrects itself on the next event.
- `.comment-body` has no styles beyond the browser defaults for blockquotes.
- `issueUrl` is not checked for the GitHub prefix before it becomes an
  `href`.
- `unread` is declared as an attribute property.
- The `ALLOWED_TAGS` test only checks absence. Assert the exact list. No DOM
  test covers `markdownParseNoImages`. It needs jsdom or happy-dom.
- Headings, tables and rules in comments show as plain text. This was
  accepted on purpose.
- The phase 2 UI was not measured in the running app: dot placement in the
  tab, card ellipsis, markdown inside the shadow root, the tooltip on a
  native button and textarea sizing. The manual checklist covers them.
- Translation checks for native speakers: fr "ticket" against the older
  "issue", ja mixes 未解決, 解決済み and クローズ済み, and pt leans European.
  The older de "Offnen" verb unit lacks its umlaut.

## Docs

- The worker README needs to say to set `WEBHOOK_SECRET` before the first
  delivery or to redeliver the ping afterward.
- Section 1 of the worker README refers to "step 7". It means section 7.
- `createIssue` tests were reformatted by Prettier in one change. Keep
  later edits to those assertions small.
