import { describe, it, expect } from 'vitest';
import { decodeMessage, encodeMessage, LAN_INVITE_PROTOCOL_VERSION } from './protocol.js';
import { generateSessionKeys, seal } from './sealing.js';
import { createPresence, HEARD_TTL_MS, type Presence, type PresenceDeps } from './presence.js';

const CODE = 'moss-0.16-hVGhlIHF1aWNrIGJyb3duIGZveA';

type Node = {
  presence: Presence;
  advertised: Uint8Array | undefined;
  unicasts: { payload: Uint8Array; address: string; port: number }[];
  invites: { code: string; groupName: string }[];
  clock: { value: number };
};

/**
 * One participant. The deps mutate this object directly, so a test can read back
 * whatever the presence machine put on the wire.
 */
function node(): Node {
  const self: Node = {
    presence: undefined as unknown as Presence,
    advertised: undefined,
    unicasts: [],
    invites: [],
    clock: { value: 1_000 },
  };
  const deps: PresenceDeps = {
    now: () => self.clock.value,
    advertise: (payload) => {
      self.advertised = payload;
    },
    stopAdvertising: () => {
      self.advertised = undefined;
    },
    unicast: (payload, address, port) => self.unicasts.push({ payload, address, port }),
    onInvite: (invite) => self.invites.push(invite),
    onChange: () => {},
  };
  self.presence = createPresence(deps);
  return self;
}

/** Hands whatever `from` last put on the wire to `to`, as the network would. */
async function deliverBeacon(from: Node, to: Node, address = '192.168.1.9'): Promise<void> {
  expect(from.advertised).toBeDefined();
  await to.presence.receive(from.advertised!, address, 47654);
}

describe('flow B: a newcomer advertises intent and a member admits them', () => {
  it('gives the newcomer a spoken name to say out loud', async () => {
    const newcomer = node();
    const name = await newcomer.presence.advertiseIntent(60_000);
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('shows the member the newcomer under that same name', async () => {
    const newcomer = node();
    const member = node();
    const name = await newcomer.presence.advertiseIntent(60_000);
    await deliverBeacon(newcomer, member);
    expect(member.presence.heardIntents().map((i) => i.name)).toEqual([name]);
  });

  it('collapses the repeats of one window into a single entry', async () => {
    const newcomer = node();
    const member = node();
    await newcomer.presence.advertiseIntent(60_000);
    await deliverBeacon(newcomer, member);
    await deliverBeacon(newcomer, member);
    await deliverBeacon(newcomer, member);
    expect(member.presence.heardIntents().length).toBe(1);
  });

  it('carries the invite code to the newcomer the member picked', async () => {
    const newcomer = node();
    const member = node();
    await newcomer.presence.advertiseIntent(60_000);
    await deliverBeacon(newcomer, member);

    const [heard] = member.presence.heardIntents();
    const admitted = await member.presence.admit([heard.sid], CODE, 'Team Standup');

    expect(admitted).toEqual([heard.sid]);
    expect(member.unicasts.length).toBe(1);
    const { payload, address } = member.unicasts[0];
    expect(address).toBe('192.168.1.9');
    await newcomer.presence.receive(payload, '192.168.1.4', 47654);

    expect(newcomer.invites).toEqual([{ code: CODE, groupName: 'Team Standup' }]);
  });

  it('tells a bystander nothing when it captures the sealed reply', async () => {
    const newcomer = node();
    const member = node();
    const bystander = node();
    await newcomer.presence.advertiseIntent(60_000);
    await bystander.presence.advertiseIntent(60_000);
    await deliverBeacon(newcomer, member);

    const [heard] = member.presence.heardIntents();
    await member.presence.admit([heard.sid], CODE, 'Team Standup');
    await bystander.presence.receive(member.unicasts[0].payload, '192.168.1.4', 47654);

    expect(bystander.invites).toEqual([]);
  });

  it('admits several people in one press', async () => {
    const first = node();
    const second = node();
    const member = node();
    await first.presence.advertiseIntent(60_000);
    await second.presence.advertiseIntent(60_000);
    await deliverBeacon(first, member, '192.168.1.9');
    await deliverBeacon(second, member, '192.168.1.10');

    const sids = member.presence.heardIntents().map((i) => i.sid);
    const admitted = await member.presence.admit(sids, CODE, 'Team Standup');
    expect(admitted.sort()).toEqual([...sids].sort());
    expect(member.unicasts.map((u) => u.address).sort()).toEqual(['192.168.1.10', '192.168.1.9']);
  });

  it('stops broadcasting when the newcomer withdraws', async () => {
    const newcomer = node();
    await newcomer.presence.advertiseIntent(60_000);
    newcomer.presence.stopIntent();
    expect(newcomer.advertised).toBeUndefined();
  });

  it('refuses a sealed invite replayed after the intent window it names has run out', async () => {
    const newcomer = node();
    const member = node();
    await newcomer.presence.advertiseIntent(10 * 60_000);
    await deliverBeacon(newcomer, member);
    const [heard] = member.presence.heardIntents();
    await member.presence.admit([heard.sid], CODE, 'Team Standup');

    // A sealed reply captured during the window and replayed a day later must
    // find nobody home, the same as flow A's offer window already does.
    newcomer.clock.value += 24 * 60 * 60_000;
    await newcomer.presence.receive(member.unicasts[0].payload, '192.168.1.4', 47654);

    expect(newcomer.invites).toEqual([]);
  });

  it('reports the intent window it is advertising, and forgets it once it lapses', async () => {
    const newcomer = node();
    const started = newcomer.clock.value;
    await newcomer.presence.advertiseIntent(10 * 60_000);
    expect(newcomer.presence.intent()).toEqual({ until: started + 10 * 60_000 });

    newcomer.clock.value += 10 * 60_000;
    expect(newcomer.presence.intent()).toBeUndefined();
  });

  it('ignores a second sealed invite for the same intent, rather than redrawing the first', async () => {
    const newcomer = node();
    const member = node();
    const impostor = node();
    await newcomer.presence.advertiseIntent(60_000);
    await deliverBeacon(newcomer, member);
    await deliverBeacon(newcomer, impostor, '192.168.1.4');

    const [heardByMember] = member.presence.heardIntents();
    await member.presence.admit([heardByMember.sid], CODE, 'Team Standup');
    await newcomer.presence.receive(member.unicasts[0].payload, '192.168.1.4', 47654);

    // Racing in behind the real invite must not swap the group name out from
    // under someone whose finger is already over the Join button.
    const [heardByImpostor] = impostor.presence.heardIntents();
    await impostor.presence.admit([heardByImpostor.sid], 'moss-0.16-evil', 'Team Standup ');
    await newcomer.presence.receive(impostor.unicasts[0].payload, '192.168.1.5', 47654);

    expect(newcomer.invites).toEqual([{ code: CODE, groupName: 'Team Standup' }]);
  });

  it('stops announcing the newcomer once their invite has arrived', async () => {
    const newcomer = node();
    const member = node();
    await newcomer.presence.advertiseIntent(60_000);
    await deliverBeacon(newcomer, member);
    const [heard] = member.presence.heardIntents();
    await member.presence.admit([heard.sid], CODE, 'Team Standup');
    await newcomer.presence.receive(member.unicasts[0].payload, '192.168.1.4', 47654);

    // Nothing is left to be admitted to, so the beacon must not go on
    // announcing this person behind the admitted panel.
    expect(newcomer.advertised).toBeUndefined();
    expect(newcomer.presence.intent()).toBeUndefined();
  });

  it('ignores a sealed invite that answers no intent of its own', async () => {
    const newcomer = node();
    const member = node();
    const other = node();
    await other.presence.advertiseIntent(60_000);
    await deliverBeacon(other, member);
    const [heard] = member.presence.heardIntents();
    await member.presence.admit([heard.sid], CODE, 'Team Standup');

    await newcomer.presence.receive(member.unicasts[0].payload, '192.168.1.4', 47654);
    expect(newcomer.invites).toEqual([]);
  });
});

describe('expiry and bounds', () => {
  it('drops an intent once its beacons stop', async () => {
    const newcomer = node();
    const member = node();
    await newcomer.presence.advertiseIntent(60_000);
    await deliverBeacon(newcomer, member);

    member.clock.value += HEARD_TTL_MS + 1;
    member.presence.expire();
    expect(member.presence.heardIntents()).toEqual([]);
  });

  it('keeps an intent alive while its beacons keep arriving', async () => {
    const newcomer = node();
    const member = node();
    await newcomer.presence.advertiseIntent(60_000);
    await deliverBeacon(newcomer, member);

    member.clock.value += HEARD_TTL_MS - 1;
    await deliverBeacon(newcomer, member);
    member.clock.value += HEARD_TTL_MS - 1;
    member.presence.expire();
    expect(member.presence.heardIntents().length).toBe(1);
  });

  it('refuses to grow without bound when the network is flooded', async () => {
    const member = node();
    for (let i = 0; i < 120; i++) {
      const spammer = node();
      await spammer.presence.advertiseIntent(60_000);
      await deliverBeacon(spammer, member);
    }
    expect(member.presence.heardIntents().length).toBeLessThanOrEqual(50);
  });

  it('ignores a datagram that is not a valid message', async () => {
    const member = node();
    await member.presence.receive(new Uint8Array([0xc1, 0xc1]), '192.168.1.9', 47654);
    expect(member.presence.heardIntents()).toEqual([]);
  });
});

describe('duplicate names', () => {
  it('marks both entries ambiguous and refuses to admit either', async () => {
    const member = node();
    const first = node();
    await first.presence.advertiseIntent(60_000);
    await deliverBeacon(first, member, '192.168.1.9');

    // Same key under a different session id is exactly what a ground collision
    // looks like from here: two live beacons deriving one name.
    const twin = decodeAndRelabel(first.advertised!);
    await member.presence.receive(twin, '192.168.1.11', 47654);

    const heard = member.presence.heardIntents();
    expect(heard.length).toBe(2);
    expect(heard.every((i) => i.ambiguous)).toBe(true);

    const admitted = await member.presence.admit(
      heard.map((i) => i.sid),
      CODE,
      'Team Standup',
    );
    expect(admitted).toEqual([]);
    expect(member.unicasts).toEqual([]);
  });

  it('reports an ambiguous sid as not admitted, not just as nothing sent', async () => {
    // A caller cannot infer "nobody was admitted" from the unicast list alone —
    // an empty network send looks the same whether nothing was sealed or the
    // send merely hasn't been observed yet. The return value is the only thing
    // that lets a UI tell a member the truth instead of a false success.
    const member = node();
    const first = node();
    await first.presence.advertiseIntent(60_000);
    await deliverBeacon(first, member, '192.168.1.9');
    const twin = decodeAndRelabel(first.advertised!);
    await member.presence.receive(twin, '192.168.1.11', 47654);

    const [ambiguousSid] = member.presence.heardIntents().map((i) => i.sid);
    const admitted = await member.presence.admit([ambiguousSid], CODE, 'Team Standup');

    expect(admitted).toEqual([]);
  });
});

/** Re-encodes a join intent under a new session id, keeping its key. */
function decodeAndRelabel(bytes: Uint8Array): Uint8Array {
  const message = decodeMessage(bytes);
  if (!message || message.kind !== 'join-intent') throw new Error('expected a join intent');
  return encodeMessage({ ...message, sid: 'twin-session' });
}

describe('flow A: a member broadcasts an offer and a newcomer takes it', () => {
  it('lists the offered group for anyone listening', async () => {
    const member = node();
    const newcomer = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    await deliverBeacon(member, newcomer);
    expect(newcomer.presence.heardOffers().map((o) => o.groupName)).toEqual(['Team Standup']);
  });

  it('carries the invite code to a newcomer who asks for it', async () => {
    const member = node();
    const newcomer = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    await deliverBeacon(member, newcomer, '192.168.1.4');

    const [offer] = newcomer.presence.heardOffers();
    await newcomer.presence.requestInvite(offer.sid);
    expect(newcomer.unicasts.length).toBe(1);

    await member.presence.receive(newcomer.unicasts[0].payload, '192.168.1.9', 47654);
    expect(member.unicasts.length).toBe(1);

    await newcomer.presence.receive(member.unicasts[0].payload, '192.168.1.4', 47654);
    expect(newcomer.invites).toEqual([{ code: CODE, groupName: 'Team Standup' }]);
  });

  it('refuses a sealed reply from anyone but the offer it answered', async () => {
    const member = node();
    const newcomer = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    await deliverBeacon(member, newcomer, '192.168.1.4');

    const [offer] = newcomer.presence.heardOffers();
    await newcomer.presence.requestInvite(offer.sid);
    const request = decodeMessage(newcomer.unicasts[0].payload);
    if (!request || request.kind !== 'invite-request') {
      throw new Error('expected an invite-request');
    }

    // A bystander who watched the unicast request go past knows the real
    // requesterKey, so it can produce a reply that decrypts cleanly — the
    // only thing it cannot forge is the offer's own key.
    const attacker = await generateSessionKeys();
    const sealed = await seal(
      JSON.stringify({ code: CODE, groupName: 'Attacker Group' }),
      request.requesterKey,
      attacker,
    );
    const forged = encodeMessage({
      v: LAN_INVITE_PROTOCOL_VERSION,
      kind: 'invite-sealed',
      sid: offer.sid,
      senderKey: attacker.publicKeyRaw,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
    });
    await newcomer.presence.receive(forged, '192.168.1.7', 47654);
    expect(newcomer.invites).toEqual([]);

    // The reply from the offer's real key is still accepted: the check above
    // must be rejecting the wrong key, not every reply.
    await member.presence.receive(newcomer.unicasts[0].payload, '192.168.1.9', 47654);
    await newcomer.presence.receive(member.unicasts[0].payload, '192.168.1.4', 47654);
    expect(newcomer.invites).toEqual([{ code: CODE, groupName: 'Team Standup' }]);
  });

  it('stops answering once the window is closed', async () => {
    const member = node();
    const newcomer = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    await deliverBeacon(member, newcomer, '192.168.1.4');
    const [offer] = newcomer.presence.heardOffers();
    await newcomer.presence.requestInvite(offer.sid);

    member.presence.stopOffer();
    await member.presence.receive(newcomer.unicasts[0].payload, '192.168.1.9', 47654);
    expect(member.unicasts).toEqual([]);
  });

  it('stops answering once the window expires on its own, with no explicit stop', async () => {
    const member = node();
    const newcomer = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    await deliverBeacon(member, newcomer, '192.168.1.4');
    const [offer] = newcomer.presence.heardOffers();
    await newcomer.presence.requestInvite(offer.sid);

    // A request captured during the visible window and replayed after the
    // window's own deadline must find nobody home.
    member.clock.value += 60_000 + 1;
    await member.presence.receive(newcomer.unicasts[0].payload, '192.168.1.9', 47654);
    expect(member.unicasts).toEqual([]);
  });

  it('ignores a request that names an unknown session', async () => {
    const member = node();
    const newcomer = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    await deliverBeacon(member, newcomer, '192.168.1.4');
    const [offer] = newcomer.presence.heardOffers();
    await newcomer.presence.requestInvite(offer.sid);

    const other = node();
    await other.presence.receive(newcomer.unicasts[0].payload, '192.168.1.9', 47654);
    expect(other.unicasts).toEqual([]);
  });

  it('drops an offer once its beacons stop', async () => {
    const member = node();
    const newcomer = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    await deliverBeacon(member, newcomer);
    newcomer.clock.value += HEARD_TTL_MS + 1;
    newcomer.presence.expire();
    expect(newcomer.presence.heardOffers()).toEqual([]);
  });

  it('refuses to ask for an invite from a group name two beacons share', async () => {
    const first = node();
    const second = node();
    const newcomer = node();
    await first.presence.offerGroup('Team Standup', CODE, 60_000);
    await second.presence.offerGroup('Team Standup', 'moss-0.16-evil', 60_000);
    await deliverBeacon(first, newcomer, '192.168.1.4');
    await deliverBeacon(second, newcomer, '192.168.1.5');

    const [offer] = newcomer.presence.heardOffers();
    expect(offer.ambiguous).toBe(true);
    // admit() refuses an ambiguous name at seal time; requesting one has to
    // refuse the same way rather than leaning on the list having drawn it.
    expect(await newcomer.presence.requestInvite(offer.sid)).toBe(false);
    expect(newcomer.unicasts).toEqual([]);
  });

  it('reports whether a request actually went out', async () => {
    const member = node();
    const newcomer = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    await deliverBeacon(member, newcomer, '192.168.1.4');
    const [offer] = newcomer.presence.heardOffers();
    expect(await newcomer.presence.requestInvite(offer.sid)).toBe(true);
    expect(await newcomer.presence.requestInvite('a-sid-nobody-offered')).toBe(false);
  });

  it('marks two offers of the same name ambiguous', async () => {
    const first = node();
    const second = node();
    const newcomer = node();
    await first.presence.offerGroup('Team Standup', CODE, 60_000);
    await second.presence.offerGroup('Team Standup', CODE, 60_000);
    await deliverBeacon(first, newcomer, '192.168.1.4');
    await deliverBeacon(second, newcomer, '192.168.1.5');
    const offers = newcomer.presence.heardOffers();
    expect(offers.length).toBe(2);
    expect(offers.every((o) => o.ambiguous)).toBe(true);
  });
});

describe('hello, and answering it by unicast', () => {
  const HELLO = encodeMessage({ v: LAN_INVITE_PROTOCOL_VERSION, kind: 'hello' });

  it('answers a hello with the group it is offering', async () => {
    const member = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    member.unicasts.length = 0;

    await member.presence.receive(HELLO, '192.168.1.9', 47654);

    expect(member.unicasts.length).toBe(1);
    const answer = decodeMessage(member.unicasts[0].payload);
    expect(answer?.kind).toBe('group-offer');
    expect(member.unicasts[0].address).toBe('192.168.1.9');
  });

  it('answers a hello with the intent it is broadcasting', async () => {
    const newcomer = node();
    await newcomer.presence.advertiseIntent(60_000);
    newcomer.unicasts.length = 0;

    await newcomer.presence.receive(HELLO, '192.168.1.4', 47654);

    const answer = decodeMessage(newcomer.unicasts[0].payload);
    expect(answer?.kind).toBe('join-intent');
  });

  it('says nothing when it has nothing to offer', async () => {
    const idle = node();
    await idle.presence.receive(HELLO, '192.168.1.9', 47654);
    expect(idle.unicasts).toEqual([]);
  });

  it('lets a scanner learn about an offer without ever catching a broadcast', async () => {
    const member = node();
    const scanner = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);

    // The scanner never receives member.advertised — only the unicast answer.
    await member.presence.receive(HELLO, '192.168.1.9', 47654);
    await scanner.presence.receive(member.unicasts[0].payload, '192.168.1.4', 47654);

    expect(scanner.presence.heardOffers().map((o) => o.groupName)).toEqual(['Team Standup']);
  });

  it('refuses to answer the same asker again straight away, so hellos cannot amplify', async () => {
    const member = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    member.unicasts.length = 0;

    for (let i = 0; i < 20; i++) await member.presence.receive(HELLO, '192.168.1.9', 47654);
    expect(member.unicasts.length).toBe(1);

    member.clock.value += 2000;
    await member.presence.receive(HELLO, '192.168.1.9', 47654);
    expect(member.unicasts.length).toBe(2);
  });

  it('stops answering once the offer window has closed', async () => {
    const member = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    member.unicasts.length = 0;
    member.clock.value += 60_000;

    await member.presence.receive(HELLO, '192.168.1.9', 47654);
    expect(member.unicasts).toEqual([]);
  });
});
