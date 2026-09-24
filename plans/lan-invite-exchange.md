# Handing over a group invite on the local network

Status: Implemented on `feat/lan-invite-exchange`, landed 2026-09-04.

Base branch: `feat/peer-tool-transfer`.

Goal: two people in the same room can get one of them into the other's group
without typing, mailing or pasting an invite code — and without anyone else on
that network learning the code.

## The two flows

**Flow A — "safe network".** A steward or member opens Invite People and presses
_Broadcast joining link on the local network_ for a chosen number of minutes.
Anyone on that network opening Join Group sees a "Groups on this local network"
list and joins with one click. The premise is that everyone on this network may
join; the UI says so in those words.

**Flow B — "unsafe network".** A newcomer opens Join Group, presses _Ask to be
let in_, and is shown a name derived from their session key — "Purple Monkey
Fern". They say that name out loud. A steward or member opens Invite People,
sees the name in a list of people asking to join, ticks it, and presses _Add to
Group_.

Both flows deliver the same thing by the same means: the invite code, sealed to
the newcomer's ephemeral public key, sent point to point. The flows differ only
in who advertises and who chooses.

Both assume the people involved are in the same room and can talk to each other.
That assumption does real security work — it is how a newcomer knows the group
they were offered is the one their friend runs, and how a member knows the name
they picked belongs to the person who said it out loud. It also sets the tone for
the interface: the UI states what is happening and leaves verification to the
people, rather than warning them about each other.

## What this reuses

`inviteCodeFromPartialModifiers()` already produces the exact string that has to
cross the network (`moss-<version>-<base64>`), and
`partialModifiersFromInviteString()` already parses it with version checking and
typed errors. This feature is a transport for that string. It changes nothing
about how a group is joined, and the link, code and paste box behave as they do
today.

It is also independent of the mDNS work in `conductorNetworkConfig.ts`: that
configures LAN discovery _inside_ the conductor, whereas this is Moss's own
subsystem and runs on any build.

## Architecture

### Main process: a dumb datagram pipe

`src/main/lanBeacon/`

| file        | responsibility                                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `socket.ts` | the only file touching `dgram`/`os`: bind, `addMembership` on every non-loopback IPv4 interface, TTL 1, multicast loopback on; each beacon also goes to every interface's subnet broadcast address, re-read per send so a newly appeared interface gets the broadcast copy |
| `pipe.ts`   | repeat-until-deadline sending, unicast replies, inbound payload cap (~1200 B) and inbound rate limit                                                                                                                                                                       |
| `index.ts`  | service wiring for the IPC handlers                                                                                                                                                                                                                                        |

API surface, exposed over IPC in the pattern peer tool transfer established
(handlers in `src/main/index.ts`, bridge in `src/preload/admin.ts`, typed wrapper
in `src/renderer/src/electron-api.ts`):

- `startAdvertising({ payload, untilMs })` — repeat this opaque datagram every
  ~3 s until the deadline, and hand back an id for it. There is one
  advertisement slot for the whole process (one socket puts one beacon on the
  wire), so a second caller's advertisement genuinely replaces the first's; the
  id is what lets the displaced caller find that out instead of going on
  claiming to broadcast.
- `stopAdvertising(id)` — stops only the advertisement named, so an owner that
  never advertised, or whose window has already been replaced, cannot silence
  whoever holds the slot now.
- `sendUnicast(payload, address, port)`
- push event `lan-beacon-datagram` → `{ payload, remoteAddress }`

Main holds no keys and understands no message kinds. The beacon cadence lives
here rather than in the renderer because Electron throttles renderer timers when
a window is occluded, which would stall the beacon silently.

Multicast loopback is on so that dev mode's two or three agents on one machine
can see each other, which is also how most of the manual testing will happen.

### Renderer: protocol, crypto, state

`src/renderer/src/lan-invite/`

- `protocol.ts` — msgpack encode/decode and typebox validation. Pure.
- `sealing.ts` — ephemeral keys, seal, open. Pure apart from Web Crypto.
- `naming.ts` — public key to three words. Pure.
- `presence.ts` — the state machine: what is being advertised, what has been
  heard, TTL expiry, window deadlines, dedup. Takes an injected clock and send
  function, so it is pure and directly testable.
- `lan-invite-session.ts` — the reactive surface the two UI elements subscribe to,
  one instance per open dialog: opening it turns the socket on, closing it turns
  the socket off and drops every key and heard entry.

Every module except `socket.ts` runs under `yarn test:unit`.

## Wire protocol

Four msgpack messages, each carrying a protocol version and validated with
typebox on receipt. Anything malformed, oversize or of a foreign version is
dropped without logging.

1. `group-offer` — multicast, flow A — `{ v, kind, sid, groupName, offerKey }`,
   repeated while the steward's window is open.
2. `invite-request` — unicast, flow A — the joiner's ephemeral public key, sent
   back to the address the offer came from.
3. `join-intent` — multicast, flow B — `{ v, kind, sid, joinerKey }`. The
   displayed name is derived from `joinerKey` and never travels on the wire.
4. `invite-sealed` — unicast, both flows — `{ v, kind, senderKey, nonce,
ciphertext }`; the plaintext is the invite code plus the group name for
   display.

Flow A is offer → request → sealed. Flow B is intent → (steward picks) → sealed.

`sid` is a random per-window session id: it correlates a request with the offer
it answers and lets a listener collapse the repeated beacons of one window into
a single list entry.

`offerKey` is not decoration. Because the sealed reply's key derivation binds
both public keys, only the holder of the advertised `offerKey` can produce a
ciphertext the requester can open. A bystander who sees the unicast
`invite-request` go past therefore cannot race a forged reply into the joiner's
hands. Flow B has no such protection: the newcomer has heard no prior key from
the steward, which is why an arriving code is shown for confirmation with its
group name rather than joined silently.

The multicast group address and port are Moss-specific and defined once, in
`socket.ts`.

## Transport choice

Raw UDP multicast via node's `dgram` to a link-local group with TTL 1: no new
dependency, no payload-size pressure, no contention with port 5353 or with the
conductor's own mDNS, and two sockets in one process make it testable.

The group is admin-scoped — `239.255.76.67:47654` — rather than an address
squatted in the `224.0.0.0/24` routing-control block. Admin-scoped traffic is
subject to IGMP snooping, but the broadcast copy described below covers the
switch-with-no-querier case that link-local addressing would otherwise have
bought us, so there is no reason to take the address-space liberty.

Networks where this will not work, all of which degrade to "nothing found" with
the paste box still present:

- Client/AP isolation on guest Wi-Fi and many coffee shops — drops both the
  multicast and the unicast reply. This is an uncomfortable irony for flow B,
  whose whole point is untrusted networks, but nothing in our control changes it.
- Separate subnets or VLANs — beacons go out TTL 1 and do not route.
- IPv6-only networks.
- Enterprise Wi-Fi that proxies `224.0.0.251:5353` but drops other multicast.
  This is the one case where mDNS would work and this design will not. If field
  testing shows it matters, an mDNS channel can be added alongside without
  touching the protocol or the UI.

Every beacon is sent twice: once to the multicast group and once to each
interface's subnet broadcast address. Some access points — phone hotspots in
particular — pass broadcast where they drop multicast group traffic, and the cost
is a few lines in `socket.ts` and a duplicate the listener already has to
collapse by `sid`.

Phone hotspots deserve their own note, because a group of people around one
phone with no carrier connection is a case this feature is squarely meant to
serve. Android SoftAP normally bridges its stations, so both discovery and the
sealed reply should work. iOS Personal Hotspot passes client-to-client unicast
but has a long history of dropping Bonjour traffic, so multicast is where it is
most likely to fail and the broadcast copy is what may save it. The most likely
failure is not networking at all: a phone with no cellular service may refuse to
enable its hotspot, so there is nothing to join. None of this can be settled by
reasoning; it is a named case in the manual test recipe.

Locally fixable failure modes the implementation must handle: multi-homed
machines where `addMembership()` with no interface argument joins the wrong one
(VPN, `docker0`, Ethernet plus Wi-Fi), and the macOS Local Network permission
and Windows Firewall prompts on first bind.

Multicast membership is joined once, at bind, over the interfaces present at
that moment; there is no interface watcher, so an interface that appears later
(joining a Wi-Fi network with the socket already open) is never joined to the
group. The broadcast copy still adapts, because the interface list is re-read on
every send. The socket is scoped to the dialog that opened it, so the ordinary
way out is the one a user takes anyway: close the dialog and open it again. An
interface watcher is deliberately not built — it would buy back only the case of
an interface appearing while the dialog is already open.

## Sealing

Each side generates an ephemeral ECDH P-256 keypair per advertising session, non
extractable, held only in renderer memory. P-256 rather than X25519 because
Electron 32 ships Chromium 128, where WebCrypto has no X25519.

The sender derives a shared secret by ECDH against the recipient's advertised
public key, runs it through HKDF-SHA256 with both public keys in a fixed order as
salt and the protocol version plus message kind as info, and encrypts the invite
code with AES-256-GCM under a random 12-byte nonce. The recipient opens it with
its own session private key; failure is silent.

Binding both public keys into the KDF salt, over keys that are fresh per session,
means a captured `invite-sealed` cannot be replayed into a later session.

## Names derived from keys

`nameFromPublicKey(raw)` takes SHA-256 of the raw public key and uses three
11-bit slices to index a bundled 2048-word list. The BIP-39 English list is the
choice: already vetted for being unambiguous when spoken aloud, about 15 KB.
Both sides compute the same name from the same beacon, so the name itself never
goes on the wire, and nobody can claim a name they do not hold the key for.

2^33 names means grinding a specific one costs roughly a day of P-256 key
generation. On top of that, **duplicate names are flagged rather than silently
picked**: if two live beacons derive the same name, both are shown marked
ambiguous and cannot be selected. That turns even a successful grind from a
silent code theft into a visible failure. Group names in flow A get the same
treatment.

## What this does not defend against

Recorded here for whoever maintains this, not surfaced as warnings in the UI —
see the co-presence assumption above:

- Neither flow authenticates the group side. An impostor can advertise a
  plausible group name, or answer a join intent, and hand out an invite to their
  own group. The damage is landing in the wrong group, not a leaked code, and the
  duplicate flag catches the case where the real group is advertising at the same
  time. What `offerKey` does buy is that in flow A the reply provably comes from
  whoever made the offer the joiner clicked.
- Flow A means anyone on the network who asks during the window gets in. That is
  the feature, and the one thing the UI does state directly, because it is about
  what the member is switching on rather than about who else might be present.
- Advertising leaks the group's name to the network for the duration of the
  window.
- No forward secrecy beyond the session, which is also the entire lifetime of
  the exposure.
- Nothing stops someone flooding the network with join intents to bury a real
  one. The inbound rate limit and a cap on how many intents the list will show
  bound the damage; beyond that it is a nuisance visible to everyone present.

On grinding specifically: because a duplicate name is shown and blocked rather
than silently picked, a successful grind costs the attacker roughly a day of key
generation and yields only a denial of service — the victim restarts and gets a
new name, and the attacker must start over.

## Ephemerality

Nothing touches disk. Session keys are generated per advertising window and die
with it. Beacons carry a TTL and a heard entry is dropped a few seconds after the
last beacon for it. Advertising windows have a hard deadline and also stop when
the dialog closes or the app quits. Nothing survives a restart, and no peer data
or key material is written to the profile directory.

## UI

Two new elements, so neither existing dialog grows:

`groups/elements/invite/local-network-invite.ts`, a "Local network" section
inside `invite-people-dialog.ts`:

- Flow A: a duration select (5 / 15 / 60 minutes) and a _Broadcast joining link
  on the local network_ button, which becomes a live countdown and a Stop button.
  One matter-of-fact line says that anyone on this network can join while it
  runs — that is what the member is turning on, so it belongs on the button.
- Flow B: a live list of heard join intents — derived name, seconds since the
  last beacon, a checkbox each — and an _Add to Group_ button that seals the
  invite code to each selected key. Two intents deriving the same name are shown
  together and cannot be ticked, with a neutral line asking that one of them
  restart — no accusation, since the ordinary cause is chance or a stale beacon.
  The empty state says nobody nearby is asking to join.

`app/dialogs/local-network-join.ts`, above the paste box in
`join-group-dialog.ts`:

- Flow A: "Groups on this local network" appears only when something is heard;
  each row is a group name and a Join button, which sends the request and joins
  through the existing `joinGroup` path and spinner on the sealed reply. The
  group name is the whole of it — no cautionary copy about whose group it might
  really be.
- Flow B: an _Ask to be let in_ button opening a panel reading "You're visible on
  this network as **Purple Monkey Fern**. Ask a group steward or member to admit
  you", with a countdown and a Stop button. An arriving sealed code shows "You've
  been admitted to _Team Standup_" with a Join button rather than joining
  silently. The point is that the newcomer sees the group's name before entering
  it, which is all someone standing next to the person who admitted them needs.

No new permission gate: whoever can open Invite People today can broadcast. All
strings go through `msg()`, followed by `lit-localize extract` and `build` and
translations for the nine target locales.

## Testing

- Pure modules under `yarn test:unit`: protocol round-trips and rejection of
  malformed, oversize and wrong-version datagrams; sealing round-trip, wrong-key
  failure and tampered-ciphertext failure; naming determinism, known vectors and
  duplicate detection; the presence state machine driven by an injected clock for
  TTL expiry, window deadlines and dedup.
- A real two-socket loopback multicast test for `socket.ts`, skipped with a clear
  message where the sandbox blocks multicast.
- Both flows end to end in one process, two presence instances wired through a
  fake pipe, from beacon to decoded invite code.
- A manual two-machine recipe in the style of `plans/mdns-two-machine-test.md`,
  because interface selection and OS permission prompts cannot be caught in a
  unit test. Named cases: a home LAN, a phone hotspot with the phone offline, and
  a machine with an active VPN.
- A diagnostic the recipe can lean on: report whether our own beacon is heard
  back through the loopback copy, which interfaces membership was joined on, and
  how many peer beacons have arrived. Without it, every network failure looks
  like the same empty list.

## Staging

1. Transport, protocol, sealing and naming, with no UI.
2. Flow B end to end — the harder and more valuable flow.
3. Flow A on the same core, which by then is mostly UI.

Each stage is independently testable and reviewable.
