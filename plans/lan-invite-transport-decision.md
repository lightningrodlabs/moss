# LAN invite: keep the multicast transport, or move to mDNS?

Status: DECISION NOTE. Written 2026-09-07, after two-machine testing of the
feature on `feat/lan-invite-exchange`.

The question: the local-network invite exchange in Moss is built on a raw UDP
multicast transport of our own. The main runtime for this feature going forward
is Tauri, which means a Rust implementation. Should Moss's transport be thrown
away and rebuilt on mDNS now, kept, or deferred — and what should the Rust side
build on?

The feature exists to get a **new** user — someone in no group yet — a joining
code from a person in the same room, without that code crossing the network in
the clear. Everything below is judged against that.

## Why it was built on raw multicast in the first place

Two separate questions were run together at design time, and they deserve
separate answers.

**Could Moss have reused the conductor's existing LAN discovery (iroh /
kitsune2)?** No, and that constraint is real on its own. kitsune2's mDNS
bootstrap advertises a _space fingerprint_ and matches on it, so it finds peers
of a space you are already in; a newcomer is in none. There is no JS surface for
sending arbitrary bytes to a LAN peer — the only peer messaging the renderer has
is `remote_signal_arbitrary` on the group zome, inside a group, to known agents.
And that discovery only exists in the forked `holochain-0.7.0-mdns` build. Any
one of these alone ruled it out.

**Given that, should Moss have hand-rolled raw UDP multicast rather than use an
off-the-shelf mDNS library in Electron main?** This is where the cost was. The
recorded rationale was: no new dependency, no payload-size pressure, no
contention with port 5353 or with the conductor's own mDNS, and two sockets in
one process make it testable. Every one of those is about the convenience of
building it; the existing mDNS stack was treated as something to avoid colliding
with rather than something to learn from. The price was paid in field testing:
per-interface multicast pinning after a VPN swallowed the beacons, a socket
refcount across three owners, datagram size and rate limits, and the discovery
that Wi-Fi power saving drops multicast to a dozing radio — most of a day. A
library would likely have carried the interface handling. It would **not** have
avoided the power-saving problem, which is inherent to multicast; see below.

## What exists, and how much a switch would replace

The implementation is six layers. Only the bottom one is the transport.

| layer                                                                                                             | lines | under mDNS                                                                  |
| ----------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------- |
| transport — multicast + subnet broadcast, per-interface pinning, refcounted socket, size/rate limits, diagnostics | ~450  | **replaced** by a library; a unicast socket for the sealed exchange remains |
| protocol — five message kinds, msgpack + typebox                                                                  | ~140  | discovery messages become TXT records; the two exchange messages stay       |
| sealing — ECDH P-256, HKDF, AES-GCM, both keys bound into the salt                                                | ~110  | stays                                                                       |
| naming — two hand-picked 256-word lists                                                                           | ~600  | stays                                                                       |
| presence — ambiguity refusal, offer deadline, hello → unicast answer                                              | ~450  | stays; `hello` becomes an mDNS query                                        |
| session and the three UI panes                                                                                    | ~900  | stays                                                                       |

About 30% replaced, 70% kept — and the kept 70% is where every security property
and all of the UX iteration lives. A switch is a transport swap, not a restart,
which is what makes deferring it cheap.

## What actually differs

**Enterprise and conference access points.** The one case where mDNS wins
outright. Networks that drop generic multicast but run a Bonjour gateway
proxying `224.0.0.251:5353` for printers and Chromecasts — universities,
corporate guest Wi-Fi, some conference venues. Our multicast group dies there;
mDNS passes. The open-space-conference scenario, several groups announcing at
once in one room, is exactly the venue type this affects, so it is not
hypothetical.

**Port 5353 coexistence.** The mirror-image risk. A userland mDNS library in
Electron shares 5353 with the OS resolver — Avahi, mDNSResponder, Windows 10+'s
built-in one. It mostly works through `reuseAddr`; Windows is the known trouble
spot, and the forked conductor build would then run two mDNS stacks in one app.
Our private port has none of this.

**Power saving — the same either way.** mDNS is multicast, so a dozing radio
drops it identically. Measured on two laptops: 100 beacons out, 12 datagrams
in, one direction only, until power management was turned off on the receiving
side. The fix is the one already built: the scanning side transmits, and
whoever holds an offer or an intent answers by unicast, which power saving
delivers reliably. mDNS has a standard form of exactly this — the QU bit on a
query, requesting unicast responses — so under mDNS the fix is idiomatic rather
than bespoke. It still has to be re-verified; it does not come free.

**Interop with a Rust implementation — decisive.** Under the bespoke protocol, a
Rust implementation is a byte-for-byte port of `protocol.ts` and `sealing.ts`,
and the wordlist becomes a frozen cross-language spec. Under mDNS, both sides
implement a documented service name and TXT schema with standard libraries —
`mdns-sd` in Rust, `multicast-dns` in JS — and the exchange can use a standard
construction such as Noise. Standards are what make two implementations agree.

**Privacy.** Slightly worse under mDNS: a service record is visible to every
mDNS browser on the LAN, including any phone with a discovery app; the private
port's beacons are visible only to a sniffer. The group name is already accepted
as disclosed while a group is listed, so this is minor but real.

**Maintenance and testing.** The current transport is ours to maintain and has
been fixed twice; a library carries its own interface handling. But the current
transport has real socket tests and a field probe, and library behaviour is
harder to test around.

## What the Rust side should build on

The Rust question is different from the Moss one, because a Tauri runtime links
crates directly. Verified against the local trees on 2026-09-07:

- `kitsune2-lrl/crates/transport_iroh/src/lan_discovery.rs` is mDNS LAN peer
  discovery already written and in production, with a documented threat model
  including an on-link address filter. Its lockfile carries `mdns-sd`,
  `swarm-discovery`, `ed25519-dalek` and `hkdf`; iroh 1.0.3.
- `android-service-runtime-direct` (the Tauri runtime) carries the
  `iroh-holochain` fork and `iroh-quinn`.

So the Rust side does not port our transport; it builds a small policy layer on
what is there:

- **Discovery:** iroh's endpoint-level mDNS address lookup — _not_ space-scoped,
  so it can find a newcomer — or `mdns-sd` directly (v0.21.2, 4.9M downloads,
  updated 2026-09-05) for an app-level service.
- **The sealed exchange:** an iroh connection is QUIC authenticated to the
  peer's public key, so "seal the invite to this key" becomes "open a stream to
  that NodeId and write it". That deletes the bespoke ECDH/HKDF/AES-GCM
  construction and the class of bug found in review, where salt ordering could
  silently stop binding the ciphertext to both parties. Without iroh, `snow`
  (Noise framework, v0.10.0, 26M downloads) is the mature choice.
- **The spoken name:** `petname` (v3.2.0, 2M downloads, maintained) produces
  the adjective-plus-noun shape deterministically from bytes. The PGP word list
  is also worth considering: its two alternating lists are chosen for phonetic
  distinctness, which is the "say it across the table" requirement exactly.
  `names` (23M downloads) has not been updated since 2022.
- **Presence, expiry, ambiguity refusal, the offer window:** small, app-specific
  policy; no crate; the part worth writing.

The power-saving finding still applies to iroh's discovery, which is multicast.
Whether `swarm-discovery`'s re-announce interval papers over it, or the Rust
side needs the same query → unicast inversion, is a one-hour measurement on
the two laptops already set up, and it should happen before any design is
committed to.

## The question that decides it

**Do a Moss desktop user and a Tauri-app user in the same room need to see each
other?**

- If the Tauri runtime is effectively Moss on mobile — yes. Then the answer is
  mDNS, with one schema implemented on both sides, Rust first.
- If the Tauri apps are standalone single-app bundles — no. A joining code is
  per-app, there is nothing to interoperate, and the two sides can differ.

## Recommendation

**Do not throw the Moss transport away, and do not switch it now.** Merge what
exists: it works on a real network in both directions, the power-save fix is
in, and its only known loss is graceful — "None found" with the paste box still
present — on gateway-style networks.

Then answer the interop question.

- If interop is needed, design the mDNS service and TXT schema _together with_
  the Rust implementation, and swap Moss's transport layer — the 30% — to match
  afterwards. Not the other way round: having Moss adopt mDNS now and then
  change it again to fit whatever Rust settles on pays for the swap twice.
- If interop is not needed, Moss keeps its transport for as long as it earns
  its keep, and the enterprise-gateway case is the trigger for revisiting it.

Either way, before any Rust is written: run `mdns-sd` between the two laptops
with power saving on. That single measurement says whether the standard path
handles the problem that cost a day here.

## Facts this note rests on

- Two-machine test, home Wi-Fi, both flows working; then 100 beacons sent / 12
  received one direction only, fixed by `iw dev <if> set power_save off` on the
  receiver. Recipe and probe in `plans/lan-invite-two-machine-test.md` and
  `scripts/lan-path-probe.mjs`.
- Crate figures from crates.io on 2026-09-07: `mdns-sd` 0.21.2, `swarm-discovery`
  0.6.3, `iroh` 1.1.0 (fork pinned at 1.0.3 locally), `snow` 0.10.0, `spake2`
  0.5.0-pre, `magic-wormhole` 0.8.1, `petname` 3.2.0, `names` 0.14.0 (2022),
  `libp2p` 0.56.0.
