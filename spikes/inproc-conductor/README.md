# Spike: in-process Holochain conductor for Electron (WIP)

Answers whether Moss could run the conductor inside the Electron main process
via a napi addon, instead of as a sidecar binary reached over a websocket — the
way `android-service-runtime` and the Tauri plugin do it. Nothing here is
wired into Moss; it is a standalone crate plus scripts.

Built against `holochain =0.7.0`. Lair is spawned in-process and the conductor
is built with that keystore and no interfaces attached, so no admin or app
websocket exists. Exposes `launch`, `adminRequest`, `appRequest`, `callZome`
(signed host-side by the in-process lair) and `shutdown`.

## What was measured

On Linux x86_64, 16 cores. Tested under Node 22 and under Electron 32's Node;
both behave the same.

| | Result |
|---|---|
| Clean release build (LTO) | 9m45s, ~5 GB peak RSS |
| Incremental rebuild of just this crate | ~5 min (all LTO relink) |
| Addon size | 57.7 MB (the `holochain` + `lair-keystore` binaries it replaces: 58.7 MB) |
| Launch, empty data root | ~2.0 s (lair 1.37 s, conductor 0.69 s) |
| Launch, existing data | ~1.4 s |
| Listening sockets | no TCP; one unix socket, lair's own (see below) |
| `install_app` (group.happ, incl. wasm compile) | 1.9 s |
| First zome call (runs `init`) / later calls | 2.5 s / 7-8 ms |

### Startup, against the sidecar, on a copy of a real profile (6 apps, 540 MB)

Five alternating runs each, bootstrap and relay pointed at a dead address so the
copied agents could not reach peers:

| | lair | conductor | total to first `list_apps` |
|---|---|---|---|
| in-process | ~990 ms | ~1715 ms | 2.67-2.72 s |
| sidecar (`holochain-v0.7.0` + `lair-keystore-v0.7.0`) | ~485 ms | ~2100 ms | 2.56-2.71 s |

No speed gain. The in-process lair phase only looks slower because it contains
both halves of lair startup (server start ~350 ms, client connect+unlock
~335 ms); the sidecar counts the second half inside "conductor ready".

### Zome calls: websocket vs direct

Both against one in-process conductor that also had an app websocket attached,
same cell, same call, same JS signing, so only the transport differs. 1000
sequential calls per path:

| Call | ws | napi |
|---|---|---|
| `get_my_joined_applets` (tiny) | mean 10.2 ms | mean 10.5 ms |
| `hash_applet` (100 KB in) | mean 8.4 ms | mean 8.0 ms |

Indistinguishable: conductor work dominates. Timing `app_info` (no wasm) 5000
times isolates the transport: ws 0.62 ms mean vs napi 0.51 ms, so the websocket
costs ~0.1-0.2 ms per request. In Moss the saving would be smaller still,
because an applet iframe would reach the addon through postMessage + IPC
instead of its own socket.

### Findings

- The remaining unix socket is lair's: holochain's `spawn_lair_keystore_in_proc`
  runs lair's `StandaloneServer` and connects back over IPC. holochain#5977 /
  PR #5976 replace it with `InProcKeystore`; until that lands, "no local
  endpoints" is incomplete.
- Lair's socket path must fit ~108 bytes (`SUN_LEN`), which a long data path
  breaks. Moss already works around this for the sidecar by symlinking the
  keystore dir into `$TMPDIR`.
- Conductor startup emits named `tracing` events (`passphrase obtained`,
  `networking started`, `Ribosomes loaded`, `apps enabled`) that a host could
  forward as real launch state instead of matching stdout. The same lines are
  already on the sidecar's stdout, so this is about capturing them reliably.

Verdict as of 2026-09-21: not worth putting in 0.16. No speed benefit, the
socket removal is incomplete until holochain#5976 lands, and the version
coupling (a full cross-platform addon rebuild per Holochain bump) is the real
ongoing cost.

## Running it

```sh
cargo build --release && cp target/release/libinproc_conductor_spike.so inproc.node
M=../../../moss   # a Moss checkout, for @msgpack/msgpack and @holochain/client

# admin round-trip, and a check that no sockets are listening
node roundtrip.cjs ./inproc.node "$PWD/.data/n" $M/node_modules/@msgpack/msgpack

# install group.happ + signed zome calls
node zome.cjs ./inproc.node "$PWD/.data/z" $M/resources/default-apps/group.happ $M/node_modules/@msgpack/msgpack

# ws vs napi latency, and pure transport cost
node bench-zome.cjs ./inproc.node "$PWD/.data/zb" $M/resources/default-apps/group.happ $M/node_modules
node bench-transport.cjs ./inproc.node "$PWD/.data/tb" $M/resources/default-apps/group.happ $M/node_modules

# startup vs the sidecar, on two offline copies of a Moss profile
python3 bench-setup.py ~/.config/org.lightningrodlabs.moss-0.16/<ver>/<profile> .data/b
node bench-inproc.cjs ./inproc.node "$PWD/.data/b/i" $M/node_modules/@msgpack/msgpack
node bench-sidecar.cjs "$PWD/.data/b/s" <lair-bin> <holochain-bin> $M/node_modules
```

`bench-setup.py` rewrites the copies to point only at themselves and disables
bootstrap and relay, so copied agents cannot reach real peers and fork the
original source chains. Keep it that way.
