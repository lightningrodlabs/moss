**Title:** `holochain_keystore`: in-process lair should not require a unix socket (desktop embedders too, not just iOS)

**Related:** #5977 (iOS boot failure), #5976 (proposed fix), holochain/lair#118 (iOS socket path too long)

## Summary

`holochain_keystore::lair_keystore::spawn_lair_keystore_in_proc` runs lair's
`StandaloneServer` and connects back to it over its IPC socket. #5977 reports
this as an iOS bug, but it affects any application that embeds the conductor
in its own process, including desktop ones. We hit it while prototyping an
in-process conductor for Moss (Electron, via a napi addon).

## What we saw

- **Path length on Linux.** Startup fails with
  `Lair({"error":"InvalidInput","message":"path must be shorter than SUN_LEN"})`
  once the lair root is longer than roughly 100 bytes. An ordinary working
  directory was enough to trigger it. Downstream projects already work around
  this: Moss symlinks the keystore dir into `$TMPDIR` and rewrites
  `connectionUrl` before starting lair (`src/main/lairKeystore.ts`), and
  kangaroo/launcher do the same (see lair#118). An in-process embedder
  shouldn't need to rewrite lair's config to start.
- **A socket that embedding was supposed to remove.** The reason to embed the
  conductor is to have no local endpoints. Our prototype attaches no
  admin/app interfaces and has no listening TCP sockets. The only listener
  left in the process is `<lair_root>/socket`, visible on the filesystem. Lair
  still requires `hello` and `unlock` over that socket, so it isn't open
  access, but it is an endpoint that an in-process keystore doesn't need.

## Ask

In order of preference:

1. **Land #5976, or something equivalent.** Back `spawn_lair_keystore_in_proc`
   with lair's `InProcKeystore` and a persistent sql store factory, and keep
   the pid check. It fixes both iOS and desktop, and existing configs keep
   working.
2. **If replacing `StandaloneServer` isn't acceptable,** add a public
   constructor so embedders can supply their own in-process client, for
   example `MetaLairClient::from_client(LairClient)`. Today the tuple fields
   and `MetaLairClient::new` are `pub(crate)`, so outside code can't wrap an
   `InProcKeystore` without forking `holochain_keystore`.

## Environment

- Holochain / `holochain_keystore` 0.7.0, `lair_keystore_api` 0.7.1
- Linux x86_64. The conductor is embedded in Node 22 and in Electron 32's Node
  through a napi-rs addon.

---

_Unposted draft, written 2026-09-21. holochain#5977 and PR #5976 already cover
this fix, so post it as a comment on #5977 rather than as a new issue. Evidence
from the spike that this draft predates: with no admin or app interface
attached, the in-process conductor had zero listening TCP sockets and exactly
one unix socket, lair's own — see README.md._
