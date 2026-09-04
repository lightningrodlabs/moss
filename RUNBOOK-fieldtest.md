# RUNBOOK — hello/PoK field test build

**Branch:** `feat/hello-pok-fieldtest` (off `main-0.7`)
**Version:** `0.16.0-dev.5`
**Status:** FIELD-TEST-ONLY. Do not merge into `main-0.7`.

This branch bundles a **patched** Holochain 0.7.0 into Moss so we can field-test the
kitsune2 hello / proof-of-knowledge (PoK) access module.

Up to `0.16.0-dev.4` the patched binaries existed only as a local build on one
machine, side-loaded with `yarn install:local-binaries`, which capped the cohort at
Linux x86_64. For `0.16.0-dev.5` they are published as a **fork release** —
`lightningrodlabs/holochain` @ `holochain-0.7.0-hello.0`, with assets named exactly
like stock holochain releases — and the fetch pipeline is repointed at it. That makes
all five platforms buildable by CI. See §8.

---

## 1. Cohort constraint — read this first

**A build from this branch cannot talk to stock Moss. At all. On any platform.**

Patched nodes advertise `HCP2P_PROTO_VER=1002` instead of the stock value. That is
deliberate: it isolates the field-test network so patched and stock nodes cannot
interoperate. A stock peer is **rejected at preflight**, before any app traffic.

The dangerous property is that this failure is **silent from the user's side**. There
is no error, no warning, no "incompatible version" dialog — the patched node simply
never completes a connection to a stock node, so the app looks like a perfectly
working Moss that nobody else happens to be on. A tester who accidentally has a stock
build will report "the network is empty", not "I can't connect".

Two things follow, and neither is optional:

1. **Everyone in the cohort installs from the same release.** Mixing a stock Moss into
   the group produces a split-brain, not an error.
2. **Every release handing out these installers carries the partition warning.** The
   `release-dev.yaml` workflow now appends it to the release body unconditionally so
   it cannot be left out (§8.7) — do not strip it when editing the notes afterwards.

Until the `holochain-0.7.0-hello.0` fork release exists and every checksum in
`holochain-checksums.json` is filled in from it, **no platform is buildable** — the
placeholders are hard failures by design (§8.2).

---

## 2. What changed on this branch

No application code. Build tooling only:

| File                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/fetch-fns.mjs`              | Added `sha256OfFile()`; made `downloadFile()` skip the download when the target already hashes to the expected sha256, so a locally built binary can be pre-placed. **dev.5:** added the `binarySources` indirection (§8.1), unified the asset/checksum key into one `ASSET_TARGET` constant (§8.3), and made a missing checksum a hard failure (§8.2).                                                  |
| `holochain-checksums.json`           | `holochain` and `hc` repointed at the fork release via `binarySources`, plus the `_FIELD_TEST_ONLY` and `_TODO_hello_0` note blocks. `lair-keystore` and `kitsune2-bootstrap-srv` untouched and still stock.                                                                                                                                                                                             |
| `scripts/check-resources.mjs`        | New. Asserts every packaged path under `resources/` exists and matches its expected sha256, so a half-populated worktree fails at build time instead of shipping. **dev.5:** shares `ASSET_TARGET` with the fetch, and an unpinned artifact now fails rather than warns. **mdns:** it is now the only pre-packaging check — `check:binaries` runs it and nothing else, and `check-binaries.mjs` is gone. |
| `scripts/install-local-binaries.mjs` | Copies locally built patched binaries into `resources/bins/`, verifying each against `holochain-checksums.json`. Refuses to run on non-Linux-x64. **Local-dev convenience only — deliberately not in any CI path**, since CI fetches from the fork release.                                                                                                                                              |
| `package.json`                       | Added `install:local-binaries` and `check:resources`; `check:binaries` runs `check-resources.mjs`. **dev.5:** version `0.16.0-dev.5`, added the missing `homepage` field (§6), and added `yarn fetch:hc` to `setup:release` (§8.5).                                                                                                                                                                      |
| `.github/workflows/release-dev.yaml` | **dev.5:** the network-partition warning is appended to every release body unconditionally (§8.7).                                                                                                                                                                                                                                                                                                       |

### Which binaries come from where

| Binary                   | Source                                                    | Patched? |
| ------------------------ | --------------------------------------------------------- | -------- |
| `holochain`              | `lightningrodlabs/holochain` @ `holochain-0.7.0-hello.0`  | **yes**  |
| `hc`                     | `lightningrodlabs/holochain` @ `holochain-0.7.0-hello.0`  | **yes**  |
| `lair-keystore`          | `holochain/holochain` @ `holochain-0.7.0` (stock default) | no       |
| `kitsune2-bootstrap-srv` | `holochain/holochain` @ `holochain-0.7.0` (stock default) | no       |

Only `holochain` and `hc` are patched, and only they carry a `binarySources` entry.
The other two have none, which is exactly what keeps them on the stock release — see
§8.1 for why the override is per-binary rather than global.

> **Warning:** `yarn update-hc-checksums` regenerates `holochain-checksums.json` from
> GitHub release assets. Running it on this branch will wipe the patched checksums,
> the `binarySources` block, and both note blocks.

---

## 3. Reproducing the binaries

The patched Holochain lives on **`lightningrodlabs/holochain`**, branch
**`feat/hello-pok-access-0.7`** (pushed).

**Toolchain required:** `zig` and `cargo-zigbuild` (`cargo install cargo-zigbuild`),
in addition to the normal Rust toolchain.

```bash
git clone -b feat/hello-pok-access-0.7 https://github.com/lightningrodlabs/holochain
cd holochain
cargo zigbuild --release --locked --target x86_64-unknown-linux-gnu.2.34 \
  -p holochain -p holochain_cli
```

Outputs land at `target/x86_64-unknown-linux-gnu/release/{holochain,hc}` — note the
**target-qualified** path, not `target/release/`.

### Why zigbuild, and not `cargo build`

> **Never distribute a plain `cargo build --release` binary.**

A plain host build links against whatever glibc the build machine has. The first cut
of this field-test bundle was built that way on a glibc-2.39 machine, and the
resulting AppImage died on other testers' boxes with **"Missing GLIBC 2.38"**.

The stock holochain releases cap their symbol requirements at **GLIBC_2.34**, so that
is the compatibility envelope this build has to match. The `.2.34` suffix on the
zigbuild target pins exactly that. Everything else already in the bundle — stock
`lair-keystore`, stock `kitsune2-bootstrap-srv`, and the Electron runtime — is at or
below 2.34, so 2.34 is the ceiling for the bundle as a whole.

Verify any candidate binary before pinning it:

```bash
objdump -T target/x86_64-unknown-linux-gnu/release/holochain \
  | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1
# must print GLIBC_2.34 -- anything higher is not distributable
```

Both binaries report a plain `0.7.0` version string (`holochain 0.7.0` /
`holochain_cli 0.7.0`) — the version string is _not_ a way to tell patched from stock,
nor portable from non-portable. Use the sha256 and the objdump check.

**Path-dependency note.** That branch consumes **kitsune2 by absolute path**, from
`lightningrodlabs/kitsune2` branch `feat/hello-pok-access`. The `[patch]` /
path-dependency entries in its `Cargo.toml` point at a checkout on the original
build machine, so a fresh clone will not build until you either check kitsune2 out
alongside it and fix the paths, or repoint them at your own checkout. Expect to edit
paths before the first build. This is also why `--locked` matters: it keeps the
resolved kitsune2 revision stable.

---

## 4. Building Moss with the patched binaries

### Populating a fresh worktree

**Read this before building in a new clone or `git worktree`.** Several of the things
electron-builder packages are **gitignored** and produced by _separate_ fetch or build
steps. A worktree that runs only some of them still compiles and still packages — the
gap only surfaces at runtime, on a tester's machine. This has now bitten twice:

- `target/wasm32-unknown-unknown/release/hrl_locator.wasm` missing → loud, fails the
  build immediately.
- `resources/default-apps/group.happ` missing → **silent**; the AppImage built and ran
  fine, and only failed when a user created a group, with
  `FfsIoError NotFound: .../app.asar.unpacked/resources/default-apps/group.happ`.

The complete inventory of non-tracked artifacts:

| Artifact                                                     | Produced by                                                       | Packaged?                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------ |
| `resources/bins/holochain-v0.7.0-mdns.0`, `hc-v0.7.0-mdns.0` | `yarn fetch:binaries` (from the fork release)                     | yes                                  |
| `resources/bins/hc`                                          | `yarn fetch:hc` — **separate step**, not part of `fetch:binaries` | yes                                  |
| `resources/bins/lair-keystore-v0.7.0`                        | `yarn fetch:binaries` (stock)                                     | yes                                  |
| `resources/bins/kitsune2-bootstrap-srv-v0.7.0`               | `yarn fetch:binaries` (stock)                                     | yes                                  |
| `resources/default-apps/group.happ`                          | `yarn fetch:group-happ`                                           | yes                                  |
| `target/wasm32-unknown-unknown/release/hrl_locator.wasm`     | `yarn build:zomes`                                                | no, inlined into the renderer bundle |
| `out/`, `cli/dist/`                                          | `yarn build`                                                      | yes (`out/`)                         |

The unversioned `resources/bins/hc` is the easy one to lose: `fetch:binaries` produces
only `hc-v<version>`, and `fetch:hc` is a separate script. `setup:release` omitted it
until dev.5 — see §8.5.

Tracked in git and needing no fetch: `resources/conductor-config.yaml`,
`resources/icon.png`, `resources/icons/*`.

`target/` is **per-worktree** and gitignored, so a sibling checkout's build artifacts
do not carry over — each worktree must produce its own.

### Full sequence

Once the fork release exists and the checksums are filled in, this is just the normal
sequence — nothing field-test-specific is needed, because `fetch:binaries` now pulls
the patched binaries itself:

```bash
yarn install
yarn build:libs
yarn build:zomes                 # produces hrl_locator.wasm; required by yarn build
yarn fetch:binaries              # patched holochain + hc from the fork release; stock lair + bootstrap-srv
yarn fetch:hc                    # resources/bins/hc -- separate from fetch:binaries
yarn fetch:group-happ            # resources/default-apps/group.happ -- DO NOT SKIP
yarn check:binaries              # now also runs check:resources over the full inventory
yarn build                       # typecheck + iframes + electron-vite + cli
yarn build:linux                 # AppImage + deb
```

`yarn setup` wraps most of this but does not run `build:zomes`. `yarn setup:release`
is what CI runs, and as of dev.5 it covers everything except `build:zomes`, which the
workflow runs as its own step.

**Before the fork release is up**, only Linux x86_64 can be built, and only by
side-loading the local build:

```bash
yarn install:local-binaries      # copies the local patched holochain + hc into resources/bins
yarn fetch:binaries              # skips those two (sha256 already matches), fetches the rest
```

This works because `x86_64-unknown-linux-gnu` is the one checksum still holding a real
value. It is a **local-dev convenience only** and is deliberately absent from every CI
workflow — see §8.1.

### The guard against this recurring

`scripts/check-resources.mjs` (new on this branch) asserts every packaged path under
`resources/` exists **and** matches its expected sha256 — binaries against
`holochain-checksums.json`, `group.happ` against `moss.config.json`. It is what
`yarn check:binaries` runs, and every `build:*` script already invokes that, so the
assertion is picked up at all existing call sites without touching them. It is the only
such check: the narrower `check-binaries.mjs` (which only ever looked at `holochain` and
`lair-keystore`, and so missed `group.happ`) is gone. `yarn check:resources` runs the
same script under its own name.

`install:local-binaries` defaults to `../holochain-lrl/target-local/release`, the mDNS
build in the sibling holochain-lrl checkout (branch `feat/mdns-bootstrap-0.7.0-hello`,
built with `CARGO_TARGET_DIR=target-local`). Override it:

```bash
MOSS_PATCHED_BIN_DIR=/path/to/holochain/target/x86_64-unknown-linux-gnu/release \
  yarn install:local-binaries
```

Whatever you point it at must hash to the pinned checksum, and the pinned artifact is a
**zigbuild** (glibc 2.34 baseline — see section 3), so a plain `target/release` build of
the same revision will be refused here rather than shipped.

It places three files: `holochain-v0.7.0-mdns.0`, `hc-v0.7.0-mdns.0`, and `hc` (the
unversioned copy that `fetch-hc.mjs` would otherwise produce).

If `install:local-binaries` reports a sha256 mismatch, you built a different revision
than the one pinned here — do not "fix" it by editing the checksums file unless you
intend to re-pin the whole cohort.

### Verifying a build is actually patched and portable

```bash
# must equal holochain.x86_64-unknown-linux-gnu in holochain-checksums.json
sha256sum resources/bins/holochain-v0.7.0-mdns.0

objdump -T resources/bins/holochain-v0.7.0-mdns.0 \
  | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1
# must be GLIBC_2.34
```

`yarn check:resources` does the sha256 half of this for the whole inventory, so run
that rather than checking files one at a time. The `objdump` check is Linux-only and
not automated — the glibc ceiling is a property of how the binary was built, which
`check-resources.mjs` cannot see.

In a packaged app the binaries live at
`resources/app.asar.unpacked/resources/bins/`, and both checks should be re-run there
after `yarn build:linux` — that is the copy testers actually execute.

> **Note:** a matching sha256 no longer implies the binary is patched, only that it is
> the one this branch pinned. The authority on "is this patched" is
> `binarySources` — the binary came from the fork release or it did not, and that is
> also what puts the release tag in its filename. Both patched and stock binaries report
> a plain `holochain 0.7.0` version string.

---

## 5. Known accepted behaviour

**The first fire-and-forget message to a newly-met peer is dropped.**

When a node encounters a peer it has not talked to before, the hello/PoK handshake
runs before application traffic is allowed through. Fire-and-forget sends issued
during that window (typically sub-second) are discarded rather than queued. Remote
signals therefore recover on the _next_ send.

In practice this shows up as a first signal going missing right after two agents
first see each other, with everything working normally from then on. **This is
expected for this build — do not file it as a bug.** Worth telling testers up front,
since "my first message vanished" is otherwise an alarming thing to hit.

Request/response traffic is unaffected; only fire-and-forget sends in that initial
window are affected.

---

## 6. Build validation performed on this branch

### dev.5 (tooling changes only; no packaged build yet)

Linux x86_64, Node v22.14.0, yarn 1.22.22. The fork release did not exist at the time,
so this validates the mechanism, not a shippable installer:

- `yarn check:resources` — pass, 15 packaged files present and verified
- `yarn typecheck` — pass, clean
- URL routing — `holochain` and `hc` resolve to
  `lightningrodlabs/holochain/releases/download/holochain-0.7.0-hello.0/...`, while
  `lair-keystore` and `kitsune2-bootstrap-srv` resolve to
  `holochain/holochain/releases/download/holochain-0.7.0/...`. Confirmed by inspection
  of `binarySourceFor()`, and both stock URLs confirmed live (HTTP 200), including the
  Windows `.exe` asset name.
- Default download path exercised for real: deleted `lair-keystore-v0.7.0`, re-ran
  `yarn fetch:binaries`, watched it download from the stock URL and verify the sha256.
- Windows key lookup — simulated a `win32/x64` host; `ASSET_TARGET` resolves to
  `x86_64-pc-windows-msvc.exe` and `lair-keystore` now returns a real checksum where
  it previously returned `undefined`.
- Placeholder handling — `TODO-hello.0` and a missing entry both raise a hard error
  naming the artifact and the remediation, in `fetch:binaries` and `check:resources`.
- `setup:release` gap — reproduced by removing `resources/bins/hc`, which fails
  `check:resources` with `populate with: ... yarn fetch:hc`. Fixed (§8.5).

`yarn build:linux` was **not** re-run for dev.5; the `homepage` fix is verified only by
inspection of the electron-builder deb requirement. Expect the first CI run to be the
real test of it.

### dev.4 (full packaged build)

All on Linux x86_64, Node v22.14.0, yarn 1.22.22:

- `yarn install` — pass
- `yarn build:libs` — pass
- `yarn install:local-binaries` — pass, both binaries checksum-verified
- `yarn fetch:binaries` — pass; skipped all four already-correct binaries, downloading
  nothing
- `yarn fetch:group-happ` — pass, `group.happ` sha256 matches `moss.config.json`
- `yarn check:binaries` (now chaining `check:resources`) — pass, 15 packaged files
  present and verified; also negative-tested by removing `group.happ`, which correctly
  fails the build with the remediation command
- `yarn typecheck` — pass, clean
- `yarn build` — pass
- `yarn build:linux` — **AppImage produced**,
  `dist/org.lightningrodlabs.moss-0.16-0.16.0-dev.4-x86_64.AppImage`, 176,339,197 bytes
  (168 MiB); the `deb` target then failed on a pre-existing missing `homepage` field in
  `package.json`, unrelated to this branch

In-package verification under
`dist/linux-unpacked/resources/app.asar.unpacked/resources/`:

- all 15 expected files present, including `default-apps/group.happ` at the exact path
  the conductor's `FfsIoError NotFound` referenced, sha256
  `643563f7485bc8c208f170e718acf613d424f2d122a5fd7a3e671a4018725ce1`
- `bins/holochain-v0.7.0` and `bins/hc` carry the patched checksums
- `objdump -T` on the in-package `holochain` and `hc` confirms a **GLIBC_2.34** ceiling;
  stock `lair-keystore`, `kitsune2-bootstrap-srv`, and the bundled Electron runtime are
  all at or below 2.34, so the AppImage as a whole requires no more than glibc 2.34

### Pre-existing gotcha — fixed in dev.5

**`yarn build:linux` could not produce a `deb`** because `package.json` had no
`homepage` field, which electron-builder's deb target requires. The AppImage is
produced first and was unaffected, so locally this looked cosmetic — but it meant
`build:linux` always exited non-zero, which in CI would have failed the Ubuntu legs of
`release-dev.yaml` regardless of whether anything was actually wrong. `homepage` is now
set to `https://theweave.social`.

---

## 7. Remaining work for a multi-platform rollout

1. ~~Build `holochain` + `hc` for the other four targets~~ — now the job of the
   `holochain-0.7.0-hello.0` fork release (§8).
2. ~~Fix the Windows checksum-key bug~~ — fixed in dev.5 (§8.3).
3. `install-local-binaries.mjs` still guards on Linux-x64 and is **not** being extended.
   With the fork release in place, CI fetches the patched binaries like any other, so
   side-loading is only a local-dev convenience on the machine that builds them.
4. macOS builds need signing/notarization to be distributable — `release-dev.yaml`
   already carries the certificate import and the Apple secrets. They also need an
   explicit `MACOSX_DEPLOYMENT_TARGET` for the same reason Linux needs the glibc pin: a
   host build silently inherits the build machine's minimum OS version. The workflow
   sets `MACOSX_DEPLOYMENT_TARGET: 10.15` for the _Electron_ build, but the **holochain
   binaries are built elsewhere** — in the fork release's own CI — so that setting does
   not constrain them. The Linux "Missing GLIBC 2.38" failure was exactly this class of
   bug; the equivalent check on the fork's macOS assets belongs in whatever builds them.
5. There is no automated equivalent of the `objdump` glibc-ceiling check. It is a
   property of how a binary was compiled, invisible to a checksum. If the fork release's
   Linux assets are not built with the same `.2.34` zigbuild target, the AppImage will
   again fail to start on older distros with no warning from any check in this repo.

---

## 8. The 0.16.0-dev.5 release flow

This is the section to follow to actually cut installers. Everything above describes
the build; this describes shipping it.

### 8.1 How the patched binaries are fetched

`scripts/fetch-fns.mjs` used to hardcode the download URL:

```
https://github.com/holochain/holochain/releases/download/holochain-<version>/<asset>
```

Both the repo and the tag are now configurable per binary, through an optional
`binarySources` block in `holochain-checksums.json`:

```json
"binarySources": {
  "holochain": {
    "binariesRepo": "lightningrodlabs/holochain",
    "binariesTag": "holochain-0.7.0-hello.0"
  },
  "hc": {
    "binariesRepo": "lightningrodlabs/holochain",
    "binariesTag": "holochain-0.7.0-hello.0"
  }
}
```

`binarySourceFor(name, version)` resolves this, falling back to `holochain/holochain`
and `holochain-<version>` when a binary has no entry. So the URL becomes:

```
https://github.com/<binariesRepo>/releases/download/<binariesTag>/<name>-<ASSET_TARGET>
```

**The override is per-binary on purpose.** A single global `binariesRepo` would have
dragged `lair-keystore` and `kitsune2-bootstrap-srv` to the fork release too, and those
are unpatched — the fork would have to mirror them for no reason, and any drift in
those mirrors would be invisible. Having no entry is what keeps them stock, so the safe
configuration is also the one that requires no configuration.

The asset filenames in the fork release must match stock naming exactly
(`holochain-x86_64-unknown-linux-gnu`, `hc-x86_64-pc-windows-msvc.exe`, …). Nothing
about the filename is configurable, only where it is fetched from.

Local-dev note: `yarn install:local-binaries` still exists and still side-loads a local
build, but it is **not referenced by any workflow**. CI fetches from the release like
any other binary. Do not add it to a workflow — it hardcodes a Linux-x64 path on one
developer's machine.

### 8.2 Filling in the checksums — required before dispatch

`holochain-checksums.json` ships with `TODO-hello.0` in place of the `holochain` and
`hc` checksums for four of the five platforms. Those are **hard failures**, not
warnings: `yarn fetch:binaries` and `yarn check:resources` both refuse to proceed, with
a message naming the artifact and what to do about it.

```
The expected sha256 for holochain (x86_64-pc-windows-msvc.exe) is not a sha256: "TODO-hello.0".
This is a placeholder, not a checksum -- the artifact it stands for has not been pinned
yet. Fill it in from the release it is supposed to come from (see RUNBOOK-fieldtest.md)
before building.
```

Ten entries must be filled from the fork release's assets — `holochain` and `hc`, each
across all five targets. The `_TODO_hello_0` block in the file lists them individually
with the asset each one comes from.

> **The fifth platform is the trap.** `x86_64-unknown-linux-gnu` does _not_ read
> `TODO-hello.0`. It holds a real sha256 — of the **local zigbuild**, so that this
> worktree keeps building on Linux while the fork release is being produced. It will
> not match the CI-built asset even if the two are functionally identical. It must be
> overwritten along with the other four. If you forget, it fails as a sha256 mismatch
> during download rather than as an obvious "unfilled placeholder", which reads like a
> corrupted download instead of an unfinished release.

To collect them:

```bash
gh release view holochain-0.7.0-hello.0 -R lightningrodlabs/holochain \
  --json assets --jq '.assets[] | select(.name|test("^(holochain|hc)-")) | "\(.name)  \(.digest)"'
```

Then verify locally before pushing anything:

```bash
rm -rf resources/bins            # force a real fetch rather than a checksum skip
yarn fetch:binaries && yarn fetch:hc && yarn check:resources
```

Do **not** use `yarn update-hc-checksums` for this. It regenerates the whole file from
a release and will delete `binarySources`, `_FIELD_TEST_ONLY`, and `_TODO_hello_0`.

### 8.3 The Windows checksum bug this release depends on

dev.4 and earlier carried a latent bug that only mattered once Windows builds started
shipping. `fetch-fns.mjs` computed the target suffix as `x86_64-pc-windows-msvc`, while
the keys in `holochain-checksums.json` are `x86_64-pc-windows-msvc.exe`. The lookup
returned `undefined` — and verification was guarded by `if (expectedSha256Hex && ...)`,
so a missing checksum **silently skipped verification entirely**. Every Windows download
was unverified, in a scheme whose entire safety argument is that downloads are pinned.

Both halves are fixed:

- The asset filename and the checksum key are now derived from one exported
  `ASSET_TARGET` constant, which `check-resources.mjs` imports rather than keeping its
  own copy of the same platform mapping. The two can no longer disagree.
- A missing or non-sha256 checksum is a **hard failure** everywhere — `downloadFile()`
  refuses to download, `check-resources.mjs` refuses to pass. This converts checksum
  pinning from advisory to enforced, and it is what makes the `TODO-hello.0`
  placeholders safe to ship in the file at all.

### 8.4 Dispatching the release

The workflow is `.github/workflows/release-dev.yaml`, named **publish-dev**.

Preconditions, in order:

1. All ten checksums filled from the fork release (§8.2), verified locally.
2. `package.json` version reads `0.16.0-dev.5`.
3. Branch `feat/hello-pok-fieldtest` pushed to `lightningrodlabs/moss`.

Then, from the Actions tab → **publish-dev** → _Run workflow_, selecting branch
`feat/hello-pok-fieldtest`. Or:

```bash
gh workflow run release-dev.yaml --ref feat/hello-pok-fieldtest \
  -f release_notes='hello/PoK field test build.'
```

`workflow_dispatch` runs the workflow file _from the selected ref_, so the branch's own
version of both the workflow and the checksums is what runs.

What it does:

- `create-release` computes `TAG=v<pkg.version>-test.<run_number>` — so
  `v0.16.0-dev.5-test.N` — and creates it as a **prerelease**.
- `build` fans out over `[windows-2022, macos-15-intel, macos-latest, ubuntu-22.04,
ubuntu-22.04-arm]` with `fail-fast: false`, runs `yarn setup:release` then
  `yarn build:zomes` then the platform `build:*` script, and uploads **installers only**.

Because `fail-fast` is off, one platform failing still ships the others. Check every
leg before handing out links — a partially-successful run looks like a successful one
on the release page.

### 8.5 Why `setup:release` needed a fix

`yarn fetch:binaries` produces `hc-v<version>`; the unversioned `resources/bins/hc`
comes from the separate `yarn fetch:hc`. `setup:release` was the only setup path that
omitted it — `setup`, `test.yaml` and `e2e.yaml` all ran it.

That was survivable while `check-binaries.mjs` only looked at `holochain` and
`lair-keystore`. It stopped being survivable the moment `check:binaries` started
chaining `check:resources`, which asserts the full packaged inventory: the release
workflow would have failed on **all five platforms** with a missing
`resources/bins/hc`. `yarn fetch:hc` is now part of `setup:release`, which also fixes
`release.yaml` and `release-manual.yaml`.

This is the gate working as intended — it caught a real gap that had been shipping
quietly — but it does mean any _new_ entry in `check-resources.mjs`'s inventory must
have a corresponding step in `setup:release`, or every release build fails.

### 8.6 Auto-updater safety

Existing Moss installs must not be dragged onto a network-partitioned build. Three
independent things prevent it, and the workflow documents its own reasoning:

> ```
> # Cuts a test build across all platforms for early real-world testing
> # (primarily the ASR feature). Builds are uploaded to a prerelease
> # tagged v<pkg.version>-test.<run_number> — marked prerelease so the
> # production auto-updater (which reads releases/latest/download) never
> # serves them to existing Moss installs.
> ```

> ```
> # --prerelease keeps this out of the auto-updater path. --notes
> # body is editable after the run.
> ```

> ```
> # Installer-only upload. We intentionally skip latest*.yml files
> # so the production auto-updater won't resolve this release — the
> # prerelease flag gives belt-and-braces protection on top.
> ```

So: **(a)** the release is marked prerelease, and the updater resolves
`releases/latest/download`, which never points at a prerelease; **(b)** no `latest*.yml`
metadata is uploaded, so even a client pointed straight at the release has nothing to
resolve; **(c)** the tag `v0.16.0-dev.5-test.N` is distinct from the eventual stable
tag.

There is a fourth, weaker property the release body already states: an installed
field-test build reports its version as `0.16.0-dev.5`, so when a real `0.16.0-dev.5`
ships, version equality means auto-update will **not** migrate testers off it. Testers
must install the stable build by hand. This is worth repeating to the cohort — it is
the mechanism by which someone quietly stays on a partitioned build for weeks.

Do not add `--latest`, drop `--prerelease`, or start uploading `latest*.yml` from this
workflow. Any one of those would push a partitioned build to the entire user base.

### 8.7 Release notes — mandatory content

`release-dev.yaml` appends the following to every release body, regardless of what is
passed as `release_notes`, so it cannot be forgotten:

- this build is network-partitioned from stock Moss by design
  (`HCP2P_PROTO_VER=1002`), and stock peers are rejected at preflight;
- the failure mode is **silent** — it looks like an empty network, not an error;
- everyone in the cohort must install from this same release;
- do not hand it to anyone outside the cohort;
- the first fire-and-forget message to a brand-new peer is dropped while the hello/PoK
  handshake runs, and recovers on the next send (§5) — expected, not a bug;
- what mDNS LAN discovery does and how to switch it off (§9).

It is appended by the workflow rather than typed by hand because a build handed out
without it does not look broken to its user. It looks like a working Moss that nobody
else is on, and that misdiagnosis costs a tester an afternoon. If you edit the release
notes after the run, leave that block in place.

---

## 9. The mDNS LAN-discovery build (`holochain-0.7.0-mdns.0`)

The `feat/mdns-dev-build-0.7` branch adds LAN peer discovery on top of the hello/PoK
build. It is **additive**: the hello/PoK access module and the
`HCP2P_PROTO_VER=1002` partition of §1 still apply unchanged, so everything above
about cohort isolation holds.

**Fork release:** `lightningrodlabs/holochain` @ `holochain-0.7.0-mdns.0`, repointed
through the same `binarySources` mechanism as §8.1. `lair-keystore` and
`kitsune2-bootstrap-srv` remain stock.

### 9.1 The fork binaries have their own filenames

A binary is named after the release it came from. `binarySources` in
`holochain-checksums.json` — the same block that repoints the fetch (§8.1) — is the
only place that says which binaries are fork builds, so the file on disk and the
release it was downloaded from cannot drift apart. With `holochain` and `hc` sourced
from `holochain-0.7.0-mdns.0` they land in `resources/bins` as
`holochain-v0.7.0-mdns.0` and `hc-v0.7.0-mdns.0` rather than `…-v0.7.0`.

That is what makes it impossible for a stock `holochain-v0.7.0` left over in the
(gitignored) `resources/bins` from another branch to be packaged as if it were the
fork: the app looks for a filename that only the fork fetch produces.
`lair-keystore` and `kitsune2-bootstrap-srv` have no `binarySources` entry, so they
are fetched from the stock release and keep `-v0.7.0`.

The derivation lives in `scripts/binary-names.mjs`, shared by the build scripts and
by the electron main process (`src/main/const.ts`, which also uses it for the
"Starting Holochain …" the splash screen shows). Remove the `binarySources` entries
and everything reverts to stock releases and stock naming.

`yarn check:binaries` **hashes** every packaged binary against
`holochain-checksums.json` rather than checking that it exists, for the same reason:
existence alone cannot tell a stale binary from the pinned one.

### 9.2 The switch

mDNS discovery is **on by default**. To turn it off:

```bash
moss --disable-mdns
```

It is a **per-launch switch, not a stored preference**: the next launch without the
flag has mDNS on again. The flag sets `network.advanced.mdnsBootstrap.enabled` and
`network.advanced.irohTransport.enableLanDiscovery` in `conductor-config.yaml`, and
both are always written explicitly, `false` included — the config file is rewritten
from the run options on every launch, and a node that once ran with mDNS on needs
that explicit `false` to stop announcing. Composition lives in
`src/main/conductorNetworkConfig.ts` (`composeAdvancedSettings`).

Both keys are kitsune2 _module_ config, and kitsune2 ignores module keys it does not
recognise, so a config written by this build is still loadable by a stock holochain
binary.

### 9.3 Confirming it is actually working

**1. The node is announcing itself.** On the machine running Moss:

```bash
avahi-browse -trp _kitsune2._udp
```

Each running conductor shows up as a resolved record whose TXT fields carry
`spacefp` (the space fingerprint — it must match on both machines for them to be
candidates for each other) and `url` (the peer URL to dial). No records means the
mDNS module is off or `avahi-daemon` is not running.

**2. Peers are being found and dialled.** The lines below are `debug`/`info` and the
conductor defaults to `RUST_LOG=warn`, so they are not in the log unless you raise the
level for those modules. Launch with:

```bash
moss --print-holochain-logs \
  --holochain-rust-log 'warn,kitsune2_bootstrap_mdns=debug,kitsune2_transport_iroh=info,kitsune2_core::factories::core_hello=debug'
```

With the level raised, the lines go to the logfile too, whether or not you pass
`--print-holochain-logs`:
`~/.config/org.lightningrodlabs.moss-<breaking-version>/<breaking-version>/<profile>/logs/we.log`
(profile is `default` unless you passed `--profile`). Then look for:

```
mdns: discovered peer, dialling url=
```

**3. The connection is direct, not relayed** — the point of the exercise:

```
Connection established … direct=true
```

`direct=true` is what says the two machines are talking over the LAN rather than
through the iroh relay. The offline test is exactly this with the bootstrap server
and relay unreachable: pull the uplink, restart both nodes, and confirm all three
signals above.
