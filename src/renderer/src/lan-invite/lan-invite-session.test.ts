import { describe, it, expect } from 'vitest';
import { get } from '@holochain-open-dev/stores';
import { LanInviteSession, type LanBeaconApi } from './lan-invite-session.js';

// The pinned vitest here (0.28.5) predates `vi.waitFor` (added in 0.34), so this
// polls the same way it would: retry the assertion until it holds or time runs out.
async function waitFor(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

/**
 * The main process's single advertisement slot: one socket puts one beacon on
 * the wire, whoever asked for it last. Sessions in a test share one of these so
 * that a second owner's advertisement genuinely displaces the first's, the way
 * it does in the app.
 */
function fakeWire() {
  let nextId = 1;
  const wire = {
    live: undefined as { id: number; payload: Uint8Array } | undefined,
    start(payload: Uint8Array): number {
      const id = nextId++;
      wire.live = { id, payload };
      return id;
    },
    stop(id?: number): void {
      if (id !== undefined && wire.live?.id !== id) return;
      wire.live = undefined;
    },
  };
  return wire;
}

function fakeApi(wire = fakeWire()) {
  const state = {
    wire,
    listening: false,
    setListeningCalls: [] as boolean[],
    stopAdvertisingCalls: [] as (number | undefined)[],
    unicasts: [] as { payload: Uint8Array; address: string }[],
    handler: undefined as
      | ((e: unknown, p: { bytes: Uint8Array; address: string; port: number }) => void)
      | undefined,
    /** What this session most recently put on the wire, whether or not it still holds it. */
    ownAdvertisement: undefined as Uint8Array | undefined,
    get advertised(): Uint8Array | undefined {
      return state.ownAdvertisement;
    },
  };
  const api: LanBeaconApi = {
    lanBeaconSetListening: async (listening) => {
      state.setListeningCalls.push(listening);
      state.listening = listening;
    },
    lanBeaconStartAdvertising: async (payload) => {
      state.ownAdvertisement = payload;
      return wire.start(payload);
    },
    lanBeaconStopAdvertising: async (id) => {
      state.stopAdvertisingCalls.push(id);
      const wasLive = wire.live?.id === id;
      wire.stop(id);
      if (id === undefined || wasLive) state.ownAdvertisement = undefined;
    },
    lanBeaconSetHello: async () => {},
    lanBeaconUnicast: async (payload, address) => {
      state.unicasts.push({ payload, address });
    },
    lanBeaconDiagnostics: async () => ({
      bound: true,
      interfaces: ['eth0'],
      advertising: wire.live !== undefined,
      advertisementId: wire.live?.id,
      sent: 0,
      received: 0,
      dropped: 0,
    }),
    onLanBeaconDatagram: (callback) => {
      state.handler = callback;
    },
  };
  return { api, state };
}

describe('LanInviteSession', () => {
  it('starts listening when opened and stops when closed', async () => {
    const { api, state } = fakeApi();
    const session = new LanInviteSession(api);
    await session.open();
    expect(state.listening).toBe(true);
    await session.close();
    expect(state.listening).toBe(false);
  });

  it('publishes the name it is advertising under', async () => {
    const { api } = fakeApi();
    const session = new LanInviteSession(api);
    await session.open();
    const name = await session.advertiseIntent(60_000);
    expect(get(session.myName)).toBe(name);
    await session.close();
  });

  it('lists an intent heard from the network', async () => {
    const { api: apiA, state: stateA } = fakeApi();
    const newcomer = new LanInviteSession(apiA);
    await newcomer.open();
    const name = await newcomer.advertiseIntent(60_000);
    expect(stateA.advertised).toBeDefined();

    const { api: apiB, state: stateB } = fakeApi();
    const member = new LanInviteSession(apiB);
    await member.open();
    stateB.handler!(null, { bytes: stateA.advertised!, address: '192.168.1.9', port: 47654 });

    await waitFor(() => expect(get(member.intents).length).toBe(1));
    expect(get(member.intents)[0].name).toBe(name);

    await newcomer.close();
    await member.close();
  });

  it('clears everything on close, so nothing outlives the dialog', async () => {
    const { api } = fakeApi();
    const session = new LanInviteSession(api);
    await session.open();
    await session.advertiseIntent(60_000);
    await session.close();
    expect(get(session.myName)).toBeUndefined();
    expect(get(session.intents)).toEqual([]);
    expect(get(session.receivedInvite)).toBeUndefined();
  });

  it('calling close() twice releases the shared beacon socket only once', async () => {
    const { api, state } = fakeApi();
    const session = new LanInviteSession(api);
    await session.open();
    await session.close();
    // A second close() on a session that already closed must be a no-op: it
    // must not send a second release to the shared, refcounted beacon
    // socket, which would incorrectly close it out from under another
    // session still listening.
    await session.close();
    expect(state.setListeningCalls.filter((listening) => listening === false).length).toBe(1);
  });

  it('drops a datagram whose async processing outlives close(), instead of writing it late', async () => {
    const { api: apiA, state: stateA } = fakeApi();
    const newcomer = new LanInviteSession(apiA);
    await newcomer.open();
    await newcomer.advertiseIntent(60_000);

    const { api: apiB, state: stateB } = fakeApi();
    const member = new LanInviteSession(apiB);
    await member.open();

    // Gate crypto.subtle.digest with a promise this test controls, so the
    // receive() chain (which awaits it via nameFromPublicKey) is deterministically
    // still in flight when close() returns — no arbitrary real-time delay needed.
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    crypto.subtle.digest = (async (
      ...args: Parameters<typeof originalDigest>
    ): Promise<ArrayBuffer> => {
      await gate;
      return originalDigest(...args);
    }) as typeof crypto.subtle.digest;

    try {
      // Fire-and-forget: this kicks off presence.receive() but nothing here
      // awaits it, so it is parked on the gated digest call above.
      stateB.handler!(null, { bytes: stateA.advertised!, address: '192.168.1.9', port: 47654 });

      // close()'s own awaits are on the fake IPC (instant), so it finishes and
      // returns while the digest inside receive() is still gated shut.
      await member.close();

      // Only now let the stalled receive() chain finish. The real digest
      // resolves via native crypto rather than a plain microtask, so give it
      // actual event-loop turns rather than just draining microtasks.
      release!();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      expect(get(member.intents)).toEqual([]);
    } finally {
      crypto.subtle.digest = originalDigest;
    }
  });
});

describe('LanInviteSession, flow B window', () => {
  it('publishes the window its name is visible for', async () => {
    const { api } = fakeApi();
    const session = new LanInviteSession(api);
    await session.open();
    const before = Date.now();
    await session.advertiseIntent(10 * 60_000);
    const intending = get(session.intending);
    expect(intending).toBeDefined();
    expect(intending!.until).toBeGreaterThanOrEqual(before + 10 * 60_000);
    await session.close();
  });

  it('stops saying the user is visible once the intent window has lapsed', async () => {
    const { api } = fakeApi();
    const session = new LanInviteSession(api, { tickMs: 5 });
    await session.open();
    await session.advertiseIntent(20);
    expect(get(session.myName)).toBeDefined();

    // The pane must not go on reading "You are visible on this network as
    // Purple Monkey" once nothing is being broadcast under that name.
    await waitFor(() => {
      expect(get(session.myName)).toBeUndefined();
      expect(get(session.intending)).toBeUndefined();
    });
    await session.close();
  });
});

describe('LanInviteSession, asking a broadcasting group to let you in', () => {
  async function offeringWire() {
    const wire = fakeWire();
    const { api: memberApi, state: memberState } = fakeApi(wire);
    const member = new LanInviteSession(memberApi);
    await member.open();
    await member.offerGroup('Team Standup', 'moss-0.16-abc', 60_000);
    return { wire, member, memberState };
  }

  it('shows the press as pending until a reply arrives', async () => {
    const { member, memberState } = await offeringWire();
    const { api: joinerApi, state: joinerState } = fakeApi();
    const joiner = new LanInviteSession(joinerApi, { requestTimeoutMs: 10_000 });
    await joiner.open();
    joinerState.handler!(null, {
      bytes: memberState.advertised!,
      address: '192.168.1.4',
      port: 47654,
    });
    await waitFor(() => expect(get(joiner.offers).length).toBe(1));

    const [offer] = get(joiner.offers);
    await joiner.requestInvite(offer.sid);
    expect(get(joiner.requesting)).toEqual({ sid: offer.sid, state: 'pending' });

    // The member answers, as the network would.
    memberState.handler!(null, {
      bytes: joinerState.unicasts[0].payload,
      address: '192.168.1.9',
      port: 47654,
    });
    await waitFor(() => expect(memberState.unicasts.length).toBe(1));
    joinerState.handler!(null, {
      bytes: memberState.unicasts[0].payload,
      address: '192.168.1.4',
      port: 47654,
    });

    await waitFor(() => expect(get(joiner.receivedInvite)).toBeDefined());
    expect(get(joiner.requesting)).toBeUndefined();
    await joiner.close();
    await member.close();
  });

  it('says so when nothing answers, rather than leaving a dead-looking button', async () => {
    const { member, memberState } = await offeringWire();
    const { api: joinerApi, state: joinerState } = fakeApi();
    const joiner = new LanInviteSession(joinerApi, { requestTimeoutMs: 20 });
    await joiner.open();
    joinerState.handler!(null, {
      bytes: memberState.advertised!,
      address: '192.168.1.4',
      port: 47654,
    });
    await waitFor(() => expect(get(joiner.offers).length).toBe(1));

    // Nobody answers — AP client isolation dropping the unicast reply is the
    // failure this design names as most likely.
    const [offer] = get(joiner.offers);
    await joiner.requestInvite(offer.sid);
    await waitFor(() =>
      expect(get(joiner.requesting)).toEqual({ sid: offer.sid, state: 'no-reply' }),
    );

    await joiner.close();
    await member.close();
  });

  it('keeps the first invite on screen when a second arrives for the same exchange', async () => {
    const { api: joinerApi, state: joinerState } = fakeApi();
    const joiner = new LanInviteSession(joinerApi);
    await joiner.open();
    await joiner.advertiseIntent(10 * 60_000);

    async function admits(groupName: string, code: string) {
      const { api, state } = fakeApi();
      const session = new LanInviteSession(api);
      await session.open();
      state.handler!(null, {
        bytes: joinerState.advertised!,
        address: '192.168.1.9',
        port: 47654,
      });
      await waitFor(() => expect(get(session.intents).length).toBe(1));
      await session.admit([get(session.intents)[0].sid], code, groupName);
      await waitFor(() => expect(state.unicasts.length).toBe(1));
      const sealed = state.unicasts[0].payload;
      await session.close();
      return sealed;
    }

    const real = await admits('Team Standup', 'moss-0.16-abc');
    const impostor = await admits('Team Standup ', 'moss-0.16-evil');

    joinerState.handler!(null, { bytes: real, address: '192.168.1.4', port: 47654 });
    await waitFor(() => expect(get(joiner.receivedInvite)).toBeDefined());
    joinerState.handler!(null, { bytes: impostor, address: '192.168.1.5', port: 47654 });
    await new Promise((resolve) => setTimeout(resolve, 30));

    // What the user is about to press Join on must not be redrawn under them.
    expect(get(joiner.receivedInvite)).toEqual({
      code: 'moss-0.16-abc',
      groupName: 'Team Standup',
    });
    await joiner.close();
  });
});

describe('LanInviteSession advertisement ownership', () => {
  it('does not stop an advertisement it never started', async () => {
    const wire = fakeWire();
    const { api: broadcasterApi } = fakeApi(wire);
    const broadcaster = new LanInviteSession(broadcasterApi);
    await broadcaster.open();
    await broadcaster.offerGroup('Team Standup', 'moss-0.16-abc', 60 * 60_000);
    expect(wire.live).toBeDefined();

    // A second owner — another group's pane, or the debugging panel — that
    // opens and closes without ever advertising anything of its own.
    const { api: bystanderApi } = fakeApi(wire);
    const bystander = new LanInviteSession(bystanderApi);
    await bystander.open();
    await bystander.close();

    expect(wire.live, 'the running broadcast was silenced by an unrelated close').toBeDefined();
    await broadcaster.close();
  });

  it('stops only its own advertisement when it closes', async () => {
    const wire = fakeWire();
    const { api: firstApi } = fakeApi(wire);
    const first = new LanInviteSession(firstApi);
    await first.open();
    await first.offerGroup('Team Standup', 'moss-0.16-abc', 60 * 60_000);

    const { api: secondApi } = fakeApi(wire);
    const second = new LanInviteSession(secondApi);
    await second.open();
    await second.offerGroup('Book Club', 'moss-0.16-def', 60 * 60_000);
    const displacing = wire.live!.id;

    // The first owner is already displaced; its close must leave the second's
    // beacon running.
    await first.close();
    expect(wire.live?.id).toBe(displacing);
    await second.close();
    expect(wire.live).toBeUndefined();
  });

  it('stops claiming to broadcast once another owner has taken the slot', async () => {
    const wire = fakeWire();
    const { api: firstApi } = fakeApi(wire);
    const first = new LanInviteSession(firstApi, { tickMs: 5 });
    await first.open();
    await first.offerGroup('Team Standup', 'moss-0.16-abc', 60 * 60_000);
    expect(get(first.offering)).toBeDefined();

    const { api: secondApi } = fakeApi(wire);
    const second = new LanInviteSession(secondApi, { tickMs: 5 });
    await second.open();
    await second.offerGroup('Book Club', 'moss-0.16-def', 60 * 60_000);

    // The pane must not go on showing a countdown and a Stop button for a
    // beacon that is no longer going out.
    await waitFor(() => expect(get(first.offering)).toBeUndefined());
    await first.close();
    await second.close();
  });
});

describe('LanInviteSession, flow A', () => {
  it('records the deadline of the window it opened', async () => {
    const { api } = fakeApi();
    const session = new LanInviteSession(api);
    await session.open();
    const before = Date.now();
    await session.offerGroup('Team Standup', 'moss-0.16-abc', 5 * 60_000);
    const offering = get(session.offering);
    expect(offering).toBeDefined();
    expect(offering!.until).toBeGreaterThanOrEqual(before + 5 * 60_000);
    await session.close();
  });

  it('forgets the window when the offer is stopped', async () => {
    const { api } = fakeApi();
    const session = new LanInviteSession(api);
    await session.open();
    await session.offerGroup('Team Standup', 'moss-0.16-abc', 5 * 60_000);
    session.stopOffer();
    expect(get(session.offering)).toBeUndefined();
    await session.close();
  });
});
