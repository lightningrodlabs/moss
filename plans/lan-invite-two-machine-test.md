# LAN invite exchange — two-machine test recipe

Goal: two Moss users on real hardware, on three network shapes that a unit
test cannot reach, complete both flow A ("safe network" broadcast) and flow B
("unsafe network" ask-to-be-let-in) — or fail in a way the LAN Invite Beacon
diagnostic actually explains. Named cases: a home LAN, a phone hotspot with
the phone offline, and a machine with an active VPN.

This feature (`src/main/lanBeacon/`, `src/renderer/src/lan-invite/`) is
independent of the mDNS/conductor networking covered by
`plans/mdns-two-machine-test.md` — it is Moss's own UDP multicast+broadcast
beacon, runs on any build, and needs no bootstrap or relay to be reachable.
Machine A only needs a group it can already invite into; nothing here
requires taking the network offline the way the mDNS recipe does.

## Read this first: two Moss instances on ONE machine cannot complete flow A

**Do not attempt this recipe with two dev agents on a single machine.** Two
Moss instances on one machine both bind UDP 47654 with `reuseAddr`, and on a
shared port the kernel hands a **unicast** datagram to the **last socket
bound** and to that one only. Multicast and subnet broadcast are delivered to
both.

Measured on Linux, three runs, deterministic: two `reuseAddr` sockets on
47654, one sender; the first-bound socket received only the multicast copy,
the last-bound socket received both the multicast copy and the unicast.

What that means for each flow:

- **Flow A never completes between two agents on one machine.** The
  `group-offer` beacon is multicast and reaches both, so the group _does_
  appear in the joiner's list. The `invite-request` that Join sends is a
  unicast back to the offering agent, and it is swallowed by whichever agent
  bound last. If that is not the agent that made the offer, nothing answers
  and the joiner now sees "No reply" (which is correct, and is not a network
  fault).
- **Flow B works only by luck of ordering.** The `join-intent` beacon is
  multicast and always arrives; the sealed reply is a unicast and only lands
  if the newcomer's agent happens to be the last-bound socket.

So a same-machine run tests nothing reliable about either flow, and a failure
there says nothing about the network. **Both flows need two machines.** This
is a limitation of the single fixed port, not of the protocol; the manual gate
below is the only way these paths get exercised for real.

## Preparation (both machines)

1. Install a Moss build that has this feature (this branch,
   `feat/lan-invite-exchange`, or a release built from it).
2. Use a fresh profile per machine: `--profile lan-test`.
3. Machine A: while still on a normal, working network, create a small test
   group (or reuse one) so Invite People has something to broadcast. Do this
   _before_ switching to the scenario's network — group creation itself is
   not what this recipe is testing.
4. Learn the diagnostic before you need it: double-click the Moss version
   number at the bottom of the left sidebar to open the **Debugging Panel**,
   and find the **LAN Invite Beacon** section. It polls every ~2 s and shows:
   - `LAN beacon socket bound: true/false`
   - `Interfaces joined: <list, or "none">`
   - `Advertising: true/false`
   - `Datagrams received: N — dropped: M`

   Open this panel on _both_ machines before starting each scenario below —
   half of what a failure means is only visible by comparing both sides. The
   panel holds a listen claim of its own while it is open, so `bound` reads
   the state of the socket rather than reading `false` merely because no
   dialog happens to be open. `Advertising` is process-wide: it says something
   is on the wire, not that it is yours.

## Reading the panel — what each field means, and its one blind spot

- **`bound: false`** — the socket never opened, even though the panel itself
  is asking for it. Root cause is almost always the OS, not the network: a
  refused bind, the macOS Local Network permission prompt being denied or
  never answered, or Windows Firewall blocking the app. Fix at the OS level
  and reopen the panel or a dialog (either reopens the socket); no amount of
  retrying on the network side will change this reading.
- **`bound: true` with an empty interface list** — the socket is open but
  joined no interface's multicast membership. This is the multi-homed
  symptom: a machine with more than one active network interface (VPN
  tunnel, `docker0`, Ethernet _and_ Wi-Fi at once) is the case most likely to
  produce it. Disconnect the extra interfaces and reopen the dialog to
  confirm the reading changes.
- **`bound: true`, interfaces listed, `received: 0` on both machines** — the
  beacon is going out but nothing is arriving on either side. Treat this as
  the network dropping the traffic (isolation, no route between the two
  machines, a firewall between them) rather than an application bug, and
  confirm both machines actually show each other's interface list as
  non-empty before looking further.
- **`bound: true` with an interface list that is missing the network you
  just joined** — multicast membership is joined once, when the socket binds,
  over the interfaces that existed at that moment. There is no interface
  watcher, so connecting to a Wi-Fi network _after_ the dialog opened never
  joins that interface's multicast group. The per-interface broadcast copy
  still adapts (the interface list is re-read on every send), so the beacon
  may get through on broadcast alone — but do not read a stale interface list
  as a bug in interface selection. Close the dialog and open it again to
  rebind, then re-read the list. Attach interfaces before opening the dialog
  when setting up a scenario.
- **The gap this diagnostic cannot close:** `received` counts any datagram
  that clears the size cap and the inbound rate limit — nothing more. A
  datagram that clears those two checks and then fails later (fails to
  decode, carries the wrong protocol version, is sealed to a key this
  session never advertised, or names a session id nobody is tracking)
  increments `received` and nothing else; `dropped` only counts what the
  size/rate filter itself rejects. **A tester watching `received` climb with
  the UI's list staying empty must not conclude the protocol is working** —
  that reading is identical whether the arriving datagrams are valid traffic
  this session simply can't use (e.g. a message meant for a session that
  already closed) or pure noise on the wire. Corroborate with the UI (a name
  appearing in "People on this network asking to join," a group appearing in
  "Groups on this local network") before calling a scenario a pass.

## Scenario 1 — home LAN

Both machines on the same Wi-Fi/Ethernet segment, normal home router, no VPN.
This is the baseline both other scenarios are compared against.

**Flow A (broadcast).** On A: Invite People → Local network → pick a
duration → _Broadcast joining link_. On B: Join Group → confirm the group
appears under "Groups on this local network" → _Join_.

- Expect: A's panel shows `advertising: true`; B's panel shows the joined
  interface(s) on both sides and `received` climbing on B as the beacon
  repeats; the group appears in B's list within a few seconds; B joins.
- Failure reading — group never appears on B: check `bound` and interfaces on
  both machines first (see above), then check B's `received` count — zero
  means the network dropped the beacon; non-zero-but-empty-list is the
  decode-failure case above, not proof of a working link.
- Failure reading — the group appears on B and _Join_ reports "No reply":
  the multicast beacon arrived but the unicast `invite-request` or the sealed
  reply did not. On two real machines that is AP client isolation or a
  firewall between them; check `received` on A to see whether the request
  reached it at all. On one machine it is the same-port limitation at the top
  of this file, and means nothing.

**Flow B (ask to be let in).** On B: Join Group → _Ask to be let in_ →
read the three-word name shown ("You are visible on this network as
**Purple Monkey Fern**") and say it out loud. On A: Invite People → Local
network → find that name under "People on this network asking to join:" →
tick it → _Add to Group_. B should then see "You have been admitted to
**\<group name\>**" and a _Join_ button.

- Expect: A's `received` climbs while B is broadcasting the intent; B's name
  appears on A within a few seconds; after A admits, B's `received` climbs
  again for the sealed reply and the admitted screen appears.
- Failure reading: same as flow A — check `bound`/interfaces first, then
  `received` on the listening side, and don't mistake a nonzero `received`
  with an empty list for progress.

## Scenario 2 — phone hotspot, phone offline

One machine (or a phone) hosts a Wi-Fi hotspot with **no cellular
connection** (airplane mode with Wi-Fi hotspot on, or no SIM/data plan). The
other machine joins that hotspot's Wi-Fi. Both flows, same steps as
Scenario 1, run entirely on the hotspot.

- **A phone that refuses to start its hotspot at all because it has no
  cellular service is a test-setup failure, not a defect in this feature.**
  Some phones (notably iOS) require an active cellular connection before
  Personal Hotspot will even turn on; if that happens, either enable a SIM
  with data (even without letting the laptop route through it) or use a
  laptop/router as the hotspot instead, and note in the results that the
  phone-as-AP case wasn't reachable rather than recording it as a failure of
  this feature.
- **iOS Personal Hotspot in particular**: client-to-client unicast passes,
  but iOS Personal Hotspot has a long history of dropping multicast traffic.
  This is exactly why every beacon in this design is sent twice — once to
  the multicast group and once to each interface's directed broadcast
  address — specifically so this case still works. If multicast-only
  delivery would have failed here, the broadcast copy is what makes the
  scenario pass; if both flows still fail on an iOS hotspot, that is a real
  finding worth reporting precisely (not "multicast doesn't work here", which
  is expected, but "neither multicast nor broadcast arrived").
- **Guest-network client/AP isolation**: some hotspot implementations
  (and most "Guest" Wi-Fi in offices/cafes) isolate stations from each other
  at the AP, dropping _both_ the multicast beacon and the unicast reply.
  Nothing in this app can route around AP-level isolation — if this is what
  you're on, expect `received: 0` on both sides throughout, `bound: true`
  with the interface listed, and no message this diagnostic can give beyond
  "the network never delivered anything." Confirm this diagnosis, if
  possible, by trying a phone hotspot instead of the isolated network — if
  the same two machines succeed there, the isolated network is confirmed as
  the cause.
- Otherwise follow Scenario 1's flow-by-flow expectations and failure
  readings.

## Scenario 3 — a machine with an active VPN

One of the two machines has a VPN connected (a tunnel interface up) while on
an otherwise ordinary LAN; the other machine is plain. Run both flows.

- This is the multi-homed case named in the design: a VPN tunnel is exactly
  the kind of extra interface (alongside `docker0`, or Ethernet-plus-Wi-Fi)
  that can produce `bound: true` with an empty (or wrong) interface list on
  the VPN'd machine, because that machine now has more than one active
  network path and the beacon has to pick the right one(s).
- Expect on the VPN'd machine: check the interface list before doing anything
  else. If it lists the LAN-facing interface (e.g. `eth0`/`wlan0`, not the
  tunnel), proceed as Scenario 1. If it is empty or lists only the tunnel
  interface, that is the failure — disconnect the VPN, reopen the dialog to
  force the socket to reopen, and confirm the interface list now shows the
  LAN interface, to isolate the VPN as the cause before reporting it.
- If the interface list looks correct but nothing still arrives, treat it as
  the "no route" case: VPN software commonly adds firewall rules that block
  local-subnet multicast/broadcast even while leaving the interface itself
  listed as joined — check `received` on both sides per the general reading
  above.

## What to send back

For each scenario and each flow: pass/fail, and for any failure the exact
panel readings from **both** machines (`bound`, the interface list,
`advertising`, `received`, `dropped`) at the point of failure — not just a
description of what the UI showed. Note explicitly if a phone hotspot could
not be reached because the phone refused to start it offline; that is
recorded as untested, not failed.

## Wi-Fi power saving drops beacons, and looks exactly like a broken feature

Measured on two laptops on one home network, so this is the first thing to rule
out rather than a theoretical worry.

A station with Wi-Fi power management on has multicast and broadcast frames
buffered by the access point and delivered only at DTIM intervals, where they
are routinely dropped. Unicast survives, because it is retrieved reliably. The
result is one-directional and easy to misread: the dozing machine still _sends_
perfectly, so a probe run in the other direction looks clean and the fault
appears to be in whichever side happens to be advertising.

The symptom in the app is a group that appears, ages to the entry timeout and
vanishes, over and over, while the advertising machine's `Beacons sent` climbs
steadily.

To confirm and to work around it while testing:

    iw dev <interface> get power_save
    sudo iw dev <interface> set power_save off

Turning it off on the _receiving_ machine fixed it outright in our test, with
only occasional drops left.

This is why every open pane broadcasts a `hello` and offers and intents are
answered by unicast: the scanning side no longer has to catch a multicast
beacon, and a machine that is transmitting keeps its radio awake. Do not remove
that mechanism on the grounds that the plain beacons "work on my network" —
they work until the other laptop has been idle for a few seconds.

## The probe: testing the network without Moss

`scripts/lan-path-probe.mjs` sends four differently-addressed datagrams and
labels each, so the output names which delivery methods a network passes:

    node scripts/lan-path-probe.mjs listen              # on one machine
    node scripts/lan-path-probe.mjs send <listener-ip>  # on the other
    node scripts/lan-path-probe.mjs sendmoss            # sends exactly as Moss does

Run it in _both_ directions before concluding anything about Moss. It listens on
the same group and port the app uses, so it also eavesdrops on real beacons,
which is how to tell "Moss is not sending" from "the network is not carrying it".
On a machine without node, the AppImage carries one:

    ELECTRON_RUN_AS_NODE=1 ./org.lightningrodlabs.moss-*.AppImage lan-path-probe.mjs listen
