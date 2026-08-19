# RUNBOOK — hello/PoK field test build

**Branch:** `feat/hello-pok-fieldtest` (off `main-0.7`)
**Status:** FIELD-TEST-ONLY. Do not merge into `main-0.7`.

This branch bundles a locally built, **patched** Holochain 0.7.0 into Moss so we can
field-test the kitsune2 hello / proof-of-knowledge (PoK) access module. The patched
binaries are not published as GitHub release assets, so the normal
`yarn fetch:binaries` flow has nothing to download them from.

---

## 1. Cohort constraint — read this first

**This build is Linux x86_64 only.**

Patched nodes advertise `HCP2P_PROTO_VER=1002` instead of the stock value. That is
deliberate: it isolates the field-test network so patched and stock nodes cannot
interoperate. A stock peer is **rejected at preflight**, before any app traffic.

`holochain-checksums.json` on this branch has patched checksums **only** for
`x86_64-unknown-linux-gnu`. Every other platform entry still points at the **stock**
holochain 0.7.0 release artifacts. So if a tester on macOS or Windows runs
`yarn setup` from this branch, they will silently get a _stock_ Moss that cannot see
anyone else in the cohort — a split-brain that looks like "the network is just empty"
rather than like an error.

Until macOS and Windows binaries are built from
`lightningrodlabs/holochain` branch `feat/hello-pok-access-0.7` and their checksums
added here, **hand out Linux builds only**.

---

## 2. What changed on this branch

Four files, no application code:

| File                                 | Change                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/fetch-fns.mjs`              | Added `sha256OfFile()`, and made `downloadFile()` skip the download when the target file already exists **and** already hashes to the expected sha256. Makes the fetch idempotent and lets a locally built binary be pre-placed instead of downloaded. This change is generic and harmless upstream. |
| `holochain-checksums.json`           | `holochain` and `hc` entries for `x86_64-unknown-linux-gnu` repointed at the patched binaries, plus a `_FIELD_TEST_ONLY` note block. All other platforms untouched.                                                                                                                                  |
| `scripts/install-local-binaries.mjs` | New. Copies the locally built patched binaries into `resources/bins/` under the expected filenames, verifying each against `holochain-checksums.json`. Refuses to run on non-Linux-x64.                                                                                                              |
| `package.json`                       | Added the `install:local-binaries` script.                                                                                                                                                                                                                                                           |

### Checksums pinned

| Binary                   | sha256                                                             |                   |
| ------------------------ | ------------------------------------------------------------------ | ----------------- |
| `holochain`              | `10888746b94ea0c10a2a9f295a4369d9d1e2e53d1f799c7a30b8792c0b5780b9` | patched, zigbuild |
| `hc`                     | `3ffa907e66151f5de415d07f49b1b5c74416aa570c3656eb7efc170e9e81fc0f` | patched, zigbuild |
| `lair-keystore`          | `7a77822ab5e0020d0f3c358030d4ccfa8c6c144407a5c075d302c7b0fcf670c1` | stock, unchanged  |
| `kitsune2-bootstrap-srv` | `ba5a61c981300c1854e33cec5a091bfb2f9137ea977a938685eef0afa809b7be` | stock, unchanged  |

Only `holochain` and `hc` are patched. `lair-keystore` and `kitsune2-bootstrap-srv`
are still fetched from the stock holochain 0.7.0 release.

> **Warning:** `yarn update-hc-checksums` regenerates `holochain-checksums.json` from
> GitHub release assets. Running it on this branch will wipe both the patched
> checksums and the `_FIELD_TEST_ONLY` note.

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

```bash
yarn install
yarn build:libs
yarn install:local-binaries      # copies patched holochain + hc into resources/bins
yarn fetch:binaries              # skips the two patched ones, downloads lair + bootstrap-srv
yarn check:binaries
yarn build                       # typecheck + iframes + electron-vite + cli
yarn build:linux                 # AppImage
```

`install:local-binaries` reads from a hardcoded default build path. Override it:

```bash
MOSS_PATCHED_BIN_DIR=/path/to/holochain/target/x86_64-unknown-linux-gnu/release \
  yarn install:local-binaries
```

Point it at the **zigbuild** output dir (`target/x86_64-unknown-linux-gnu/release`),
never at `target/release` — see section 3.

It places three files: `holochain-v0.7.0`, `hc-v0.7.0`, and `hc` (the unversioned copy
that `fetch-hc.mjs` would otherwise produce).

If `install:local-binaries` reports a sha256 mismatch, you built a different revision
than the one pinned here — do not "fix" it by editing the checksums file unless you
intend to re-pin the whole cohort.

### Verifying a build is actually patched and portable

```bash
sha256sum resources/bins/holochain-v0.7.0
# must be 10888746b94ea0c10a2a9f295a4369d9d1e2e53d1f799c7a30b8792c0b5780b9

objdump -T resources/bins/holochain-v0.7.0 \
  | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1
# must be GLIBC_2.34
```

In a packaged app the binaries live at
`resources/app.asar.unpacked/resources/bins/`, and both checks should be re-run there
after `yarn build:linux` — that is the copy testers actually execute.

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

All on Linux x86_64, Node v22.14.0, yarn 1.22.22:

- `yarn install` — pass
- `yarn build:libs` — pass
- `yarn install:local-binaries` — pass, both binaries checksum-verified
- `yarn fetch:binaries` — pass; skipped all four already-correct binaries, downloading
  nothing
- `yarn check:binaries` — pass
- `yarn typecheck` — pass, clean
- `yarn build` — pass
- `yarn build:linux` — **AppImage produced**,
  `dist/org.lightningrodlabs.moss-0.16-0.16.0-dev.4-x86_64.AppImage`, 172,178,603 bytes
  (164 MiB); the `deb` target then failed on a pre-existing missing `homepage` field in
  `package.json`, unrelated to this branch

Packaged binaries under `dist/linux-unpacked/resources/app.asar.unpacked/resources/bins/`
were confirmed to carry the patched checksums, and `objdump -T` on the **in-package**
`holochain` and `hc` confirms a **GLIBC_2.34** ceiling. Stock `lair-keystore`,
`kitsune2-bootstrap-srv`, and the bundled Electron runtime are all at or below 2.34, so
the AppImage as a whole requires no more than glibc 2.34.

### Two pre-existing gotchas, unrelated to this branch

1. **`yarn build` needs the zome WASM.** The renderer imports
   `target/wasm32-unknown-unknown/release/hrl_locator.wasm`, so `yarn build:zomes`
   must have been run in _this_ worktree (`target/` is gitignored and per-worktree, so
   a sibling checkout's artifacts do not carry over).
2. **`yarn build:linux` cannot produce a `deb`** until `homepage` is added to
   `package.json`. The AppImage is produced first and is unaffected.

---

## 7. Remaining work for a multi-platform rollout

1. Build `holochain` + `hc` from `feat/hello-pok-access-0.7` for
   `aarch64-apple-darwin`, `x86_64-apple-darwin`, and `x86_64-pc-windows-msvc`.
2. Add their sha256s to `holochain-checksums.json` and extend
   `install-local-binaries.mjs` beyond its current Linux-x64 guard.
3. macOS builds additionally need signing/notarization to be distributable, and need
   an explicit `MACOSX_DEPLOYMENT_TARGET` for the same reason Linux needs the glibc
   pin — a host build silently inherits the build machine's minimum OS version. The
   Linux "Missing GLIBC 2.38" failure was exactly this class of bug; do not assume the
   other platforms are immune to it.
4. Note a latent bug in `scripts/fetch-fns.mjs`: on Windows the computed
   `targetEnding` is `x86_64-pc-windows-msvc` while the checksum keys are
   `x86_64-pc-windows-msvc.exe`. The lookup returns `undefined`, and because the
   verification is guarded by `if (expectedSha256Hex && ...)`, **Windows downloads are
   silently unverified**. This must be fixed before shipping a patched Windows build,
   or the checksum pinning that makes this whole scheme safe will not apply there.
