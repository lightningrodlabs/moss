# LAN Invite Exchange Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let two people in the same room move a group invite between their Moss instances over the local network, without typing a code and without the code crossing the network in the clear.

**Architecture:** The Electron main process gets a dumb UDP datagram pipe that knows nothing about message kinds or keys — it repeats an opaque payload on a schedule, sends unicast replies, and forwards inbound datagrams to the renderer. The renderer owns the protocol, the sealing and the state machine, all as pure modules. The payload being moved is the invite code the app already produces, so no join logic changes.

**Tech Stack:** TypeScript, Electron 32, node `dgram`, `@msgpack/msgpack`, `@sinclair/typebox`, WebCrypto (ECDH P-256 / HKDF-SHA256 / AES-256-GCM), Lit + Shoelace, `@lit/localize`, Vitest.

**Spec:** `plans/lan-invite-exchange.md` — read it before starting. It carries the threat model and the reasoning behind the protocol; this plan implements it.

## Global Constraints

- **No new runtime dependencies.** `@msgpack/msgpack`, `@sinclair/typebox` and Shoelace are already present; WebCrypto and `dgram` are platform.
- **ECDH P-256, not X25519.** Electron 32 ships Chromium 128, whose WebCrypto has no X25519.
- **Strong typing everywhere.** No `any` in new code; wire messages are validated with typebox before use (CLAUDE.md #4).
- **Multicast group `239.255.76.67`, port `47654`, TTL 1.** Defined once, in `src/main/lanBeacon/socket.ts`.
- **Protocol version `1`.** Datagrams of any other version are dropped silently.
- **IPC channel names must be string literals** at both the `ipcMain.handle` and `ipcRenderer.invoke` call sites — `src/main/ipc-contract-drift.test.ts` scans for literals and fails the build on a mismatch in either direction.
- **Nothing is written to disk.** No key material, no peer data, no preferences.
- **Every user-visible string goes through `msg()`** from `@lit/localize`, followed by `extract` and `build` (Task 15).
- **Comments explain intent, not the change** (CLAUDE.md #6). No commit trailers or generated-by lines (CLAUDE.md).
- **Keep files focused** (CLAUDE.md #8). The two dialogs get new child elements rather than growing.
- **Tests:** `yarn test:unit` (Vitest, `environment: 'node'`, includes `src/**/*.test.ts`). Only pure modules are unit-tested; Lit elements are verified by `yarn typecheck` and manual runs.

## File Structure

**Main process — transport only, no protocol, no keys**

| File                           | Responsibility                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/lanBeacon/socket.ts` | The only file touching `dgram`/`os`. Binds, joins the multicast group on every non-loopback IPv4 interface, sends to the group and to each interface's broadcast address, reports which interfaces it joined. |
| `src/main/lanBeacon/pipe.ts`   | Repeat-until-deadline scheduling, inbound size cap and rate limit, diagnostics counters. Pure: takes an injected socket and clock.                                                                            |
| `src/main/lanBeacon/index.ts`  | Assembles socket + pipe into the service the IPC handlers call.                                                                                                                                               |

**Renderer — protocol, crypto, state**

| File                                                              | Responsibility                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/lan-invite/wordlist.ts`                         | The 2048-word list, vendored. Data only.                                                                          |
| `src/renderer/src/lan-invite/naming.ts`                           | Public key → three-word name; duplicate detection over a set of names.                                            |
| `src/renderer/src/lan-invite/protocol.ts`                         | Wire types, msgpack encode/decode, typebox validation.                                                            |
| `src/renderer/src/lan-invite/sealing.ts`                          | Ephemeral keypairs, seal, open.                                                                                   |
| `src/renderer/src/lan-invite/presence.ts`                         | The state machine: what is advertised, what is heard, expiry, both flows. Pure; injected clock and send function. |
| `src/renderer/src/lan-invite/lan-invite-session.ts`               | Reactive surface over `presence`, wired to `window.electronAPI`. One instance per open dialog.                    |
| `src/renderer/src/groups/elements/invite/local-network-invite.ts` | The member's half of both flows, embedded in `invite-people-dialog`.                                              |
| `src/renderer/src/app/dialogs/local-network-join.ts`              | The newcomer's half of both flows, embedded in `join-group-dialog`.                                               |

**Wiring:** `src/main/index.ts` (handlers), `src/preload/admin.ts` (bridge), `src/renderer/src/electron-api.ts` (types).

## Stages

1. **Tasks 1–8** — transport, protocol, sealing, naming, presence, IPC. No UI; ends with both flows exercised end to end in one process.
2. **Tasks 9–12** — flow B (newcomer advertises intent, member picks).
3. **Tasks 13–16** — flow A (member broadcasts an offer, newcomer picks), diagnostics, localization, manual test recipe.

---

### Task 1: The wordlist

**Files:**

- Create: `src/renderer/src/lan-invite/wordlist.ts`
- Test: `src/renderer/src/lan-invite/wordlist.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `export const WORDLIST: readonly string[]` — exactly 2048 lowercase words.

The BIP-39 English wordlist is the right artifact: it is public domain, exactly 2048 entries, and was designed so that words are unambiguous when spoken aloud and distinguishable by their first four letters. Obtain it from any of the npm package `bip39` (`src/wordlists/english.json`), `@scure/bip39` (`wordlists/english.js`), or the BIP-0039 repository. The test below verifies the structural properties that identify it, so the source does not matter.

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/src/lan-invite/wordlist.test.ts
import { describe, it, expect } from 'vitest';
import { WORDLIST } from './wordlist.js';

describe('WORDLIST', () => {
  it('has exactly 2048 entries, so three words consume 33 bits exactly', () => {
    expect(WORDLIST.length).toBe(2048);
  });

  it('holds only lowercase ascii words of a speakable length', () => {
    for (const word of WORDLIST) {
      expect(word).toMatch(/^[a-z]{3,8}$/);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
  });

  it('distinguishes every word by its first four letters, so a misheard ending is recoverable', () => {
    const prefixes = new Set(WORDLIST.map((w) => w.slice(0, 4)));
    expect(prefixes.size).toBe(WORDLIST.length);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn vitest run src/renderer/src/lan-invite/wordlist.test.ts`
Expected: FAIL — cannot resolve `./wordlist.js`.

- [ ] **Step 3: Vendor the list**

This step is data entry, not authorship: copy the 2048 words across verbatim, in
the order the source lists them, changing nothing. Order is what makes a name
reproducible, so a sorted or de-duplicated copy is a different wordlist. The test
from Step 1 is the acceptance check — if all four assertions pass, the list is
right. Wrap it in this file:

```typescript
/**
 * The BIP-39 English wordlist, used to turn an ephemeral public key into a name
 * two people can say to each other across a table. Chosen because its words are
 * unambiguous when spoken and identified by their first four letters.
 *
 * Order is significant: it is what makes a name reproducible from a key.
 */
export const WORDLIST: readonly string[] = [
  'abandon',
  'ability',
  'able',
  'about',
  'above',
  'absent',
  'absorb',
  'abstract',
  // … all 2048 words, canonical order …
  'zebra',
  'zero',
  'zone',
  'zoo',
];
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `yarn vitest run src/renderer/src/lan-invite/wordlist.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lan-invite/wordlist.ts src/renderer/src/lan-invite/wordlist.test.ts
git commit -m "feat(lan-invite): vendor the wordlist that names an ephemeral key"
```

---

### Task 2: Names derived from keys

**Files:**

- Create: `src/renderer/src/lan-invite/naming.ts`
- Test: `src/renderer/src/lan-invite/naming.test.ts`

**Interfaces:**

- Consumes: `WORDLIST` from Task 1.
- Produces:
  - `nameFromPublicKey(rawPublicKey: Uint8Array): Promise<string>` — three capitalised words joined by spaces, e.g. `"Purple Monkey Fern"`.
  - `duplicateNames(names: readonly string[]): ReadonlySet<string>` — the names appearing more than once.

`nameFromPublicKey` is async because it hashes with WebCrypto. Both sides derive the same name from the same beacon, so the name never travels on the wire.

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/src/lan-invite/naming.test.ts
import { describe, it, expect } from 'vitest';
import { duplicateNames, nameFromPublicKey } from './naming.js';

const KEY_A = new Uint8Array(65).fill(1);
const KEY_B = new Uint8Array(65).fill(2);

describe('nameFromPublicKey', () => {
  it('gives the same name for the same key every time', async () => {
    expect(await nameFromPublicKey(KEY_A)).toBe(await nameFromPublicKey(KEY_A));
  });

  it('gives different names for different keys', async () => {
    expect(await nameFromPublicKey(KEY_A)).not.toBe(await nameFromPublicKey(KEY_B));
  });

  it('produces three capitalised words', async () => {
    expect(await nameFromPublicKey(KEY_A)).toMatch(
      /^[A-Z][a-z]{2,7} [A-Z][a-z]{2,7} [A-Z][a-z]{2,7}$/,
    );
  });

  it('changes when a single byte of the key changes', async () => {
    const nudged = new Uint8Array(KEY_A);
    nudged[64] = 9;
    expect(await nameFromPublicKey(nudged)).not.toBe(await nameFromPublicKey(KEY_A));
  });
});

describe('duplicateNames', () => {
  it('is empty when every name is distinct', () => {
    expect(duplicateNames(['Purple Monkey Fern', 'Amber Otter Kite']).size).toBe(0);
  });

  it('reports a name that two beacons derived', () => {
    const dupes = duplicateNames(['Purple Monkey Fern', 'Amber Otter Kite', 'Purple Monkey Fern']);
    expect([...dupes]).toEqual(['Purple Monkey Fern']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn vitest run src/renderer/src/lan-invite/naming.test.ts`
Expected: FAIL — cannot resolve `./naming.js`.

- [ ] **Step 3: Implement**

```typescript
// src/renderer/src/lan-invite/naming.ts
import { WORDLIST } from './wordlist.js';

const WORD_COUNT = 3;
const BITS_PER_WORD = 11;

/**
 * The name two people say to each other to agree on which beacon is whose.
 *
 * Deriving it from the key rather than choosing it at random means nobody can
 * claim a name they do not hold the key for without grinding a hash collision,
 * and it keeps the name off the wire entirely.
 */
export async function nameFromPublicKey(rawPublicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', rawPublicKey));
  const words: string[] = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    words.push(WORDLIST[wordIndex(digest, i * BITS_PER_WORD)]);
  }
  return words.map(capitalise).join(' ');
}

/** Reads `BITS_PER_WORD` bits out of the digest starting at `bitOffset`. */
function wordIndex(digest: Uint8Array, bitOffset: number): number {
  let value = 0;
  for (let bit = 0; bit < BITS_PER_WORD; bit++) {
    const absolute = bitOffset + bit;
    const byte = digest[absolute >> 3];
    value = (value << 1) | ((byte >> (7 - (absolute & 7))) & 1);
  }
  return value;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Names heard more than once. A duplicate is shown and blocked rather than
 * silently picked, so that a ground collision costs an attacker a visible denial
 * of service instead of buying them someone else's invite.
 */
export function duplicateNames(names: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  return duplicates;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `yarn vitest run src/renderer/src/lan-invite/naming.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lan-invite/naming.ts src/renderer/src/lan-invite/naming.test.ts
git commit -m "feat(lan-invite): name an ephemeral key with three spoken words"
```

---

### Task 3: The wire protocol

**Files:**

- Create: `src/renderer/src/lan-invite/protocol.ts`
- Test: `src/renderer/src/lan-invite/protocol.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `LAN_INVITE_PROTOCOL_VERSION = 1`
  - `MAX_DATAGRAM_BYTES = 1200`
  - Types `GroupOffer`, `InviteRequest`, `JoinIntent`, `InviteSealed`, and the union `LanInviteMessage`.
  - `encodeMessage(message: LanInviteMessage): Uint8Array`
  - `decodeMessage(bytes: Uint8Array): LanInviteMessage | undefined` — `undefined` for anything malformed, oversize, or of a foreign version. Never throws.

Keys travel as raw bytes; msgpack carries `Uint8Array` natively. `sid` is a random per-window session id: it correlates a request with the offer it answers and lets a listener collapse a window's repeated beacons into one list entry.

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/src/lan-invite/protocol.test.ts
import { describe, it, expect } from 'vitest';
import { encode } from '@msgpack/msgpack';
import {
  decodeMessage,
  encodeMessage,
  LAN_INVITE_PROTOCOL_VERSION,
  MAX_DATAGRAM_BYTES,
  type GroupOffer,
  type InviteSealed,
  type JoinIntent,
} from './protocol.js';

const KEY = new Uint8Array(65).fill(7);

const OFFER: GroupOffer = {
  v: LAN_INVITE_PROTOCOL_VERSION,
  kind: 'group-offer',
  sid: 'abc123',
  groupName: 'Team Standup',
  offerKey: KEY,
};

const INTENT: JoinIntent = {
  v: LAN_INVITE_PROTOCOL_VERSION,
  kind: 'join-intent',
  sid: 'def456',
  joinerKey: KEY,
};

const SEALED: InviteSealed = {
  v: LAN_INVITE_PROTOCOL_VERSION,
  kind: 'invite-sealed',
  sid: 'abc123',
  senderKey: KEY,
  nonce: new Uint8Array(12).fill(3),
  ciphertext: new Uint8Array(80).fill(4),
};

describe('encodeMessage / decodeMessage', () => {
  it('round-trips a group offer', () => {
    expect(decodeMessage(encodeMessage(OFFER))).toEqual(OFFER);
  });

  it('round-trips a join intent', () => {
    expect(decodeMessage(encodeMessage(INTENT))).toEqual(INTENT);
  });

  it('round-trips a sealed invite', () => {
    expect(decodeMessage(encodeMessage(SEALED))).toEqual(SEALED);
  });

  it('keeps a beacon well under the datagram budget', () => {
    expect(encodeMessage(OFFER).length).toBeLessThan(MAX_DATAGRAM_BYTES);
  });

  it('drops a datagram of a foreign protocol version', () => {
    const foreign = encode({ ...OFFER, v: 99 });
    expect(decodeMessage(foreign)).toBeUndefined();
  });

  it('drops a datagram with an unknown kind', () => {
    const unknown = encode({ ...OFFER, kind: 'something-else' });
    expect(decodeMessage(unknown)).toBeUndefined();
  });

  it('drops a datagram whose fields have the wrong types', () => {
    const wrong = encode({ ...OFFER, offerKey: 'not-bytes' });
    expect(decodeMessage(wrong)).toBeUndefined();
  });

  it('drops a datagram missing a required field', () => {
    const partial = encode({ v: LAN_INVITE_PROTOCOL_VERSION, kind: 'join-intent', sid: 'x' });
    expect(decodeMessage(partial)).toBeUndefined();
  });

  it('drops an oversize datagram without decoding it', () => {
    const huge = encodeMessage({ ...SEALED, ciphertext: new Uint8Array(MAX_DATAGRAM_BYTES) });
    expect(decodeMessage(huge)).toBeUndefined();
  });

  it('drops bytes that are not msgpack at all', () => {
    expect(decodeMessage(new Uint8Array([0xc1, 0xc1, 0xc1]))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn vitest run src/renderer/src/lan-invite/protocol.test.ts`
Expected: FAIL — cannot resolve `./protocol.js`.

- [ ] **Step 3: Implement**

```typescript
// src/renderer/src/lan-invite/protocol.ts
import { decode, encode } from '@msgpack/msgpack';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const LAN_INVITE_PROTOCOL_VERSION = 1;

/**
 * Kept well below the ~1500 byte ethernet MTU so a beacon is never fragmented:
 * a fragmented multicast datagram is far more likely to be dropped in transit.
 */
export const MAX_DATAGRAM_BYTES = 1200;

const TBytes = Type.Unsafe<Uint8Array>({ type: 'object' });
const TVersion = Type.Literal(LAN_INVITE_PROTOCOL_VERSION);
const TSid = Type.String({ minLength: 1, maxLength: 32 });

const TGroupOffer = Type.Object(
  {
    v: TVersion,
    kind: Type.Literal('group-offer'),
    sid: TSid,
    groupName: Type.String({ maxLength: 120 }),
    offerKey: TBytes,
  },
  { additionalProperties: false },
);

const TInviteRequest = Type.Object(
  {
    v: TVersion,
    kind: Type.Literal('invite-request'),
    sid: TSid,
    requesterKey: TBytes,
  },
  { additionalProperties: false },
);

const TJoinIntent = Type.Object(
  {
    v: TVersion,
    kind: Type.Literal('join-intent'),
    sid: TSid,
    joinerKey: TBytes,
  },
  { additionalProperties: false },
);

const TInviteSealed = Type.Object(
  {
    v: TVersion,
    kind: Type.Literal('invite-sealed'),
    sid: TSid,
    senderKey: TBytes,
    nonce: TBytes,
    ciphertext: TBytes,
  },
  { additionalProperties: false },
);

const TLanInviteMessage = Type.Union([TGroupOffer, TInviteRequest, TJoinIntent, TInviteSealed]);

export type GroupOffer = Static<typeof TGroupOffer> & { offerKey: Uint8Array };
export type InviteRequest = Static<typeof TInviteRequest> & { requesterKey: Uint8Array };
export type JoinIntent = Static<typeof TJoinIntent> & { joinerKey: Uint8Array };
export type InviteSealed = Static<typeof TInviteSealed> & {
  senderKey: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
};
export type LanInviteMessage = GroupOffer | InviteRequest | JoinIntent | InviteSealed;

export function encodeMessage(message: LanInviteMessage): Uint8Array {
  return encode(message);
}

/**
 * Anything a hostile or merely mismatched host puts on the wire arrives here, so
 * every failure resolves to `undefined` rather than an exception: a listener
 * should be able to ignore rubbish without a guard at every call site.
 */
export function decodeMessage(bytes: Uint8Array): LanInviteMessage | undefined {
  if (bytes.length > MAX_DATAGRAM_BYTES) return undefined;
  let decoded: unknown;
  try {
    decoded = decode(bytes);
  } catch {
    return undefined;
  }
  if (!isBytesShaped(decoded)) return undefined;
  if (!Value.Check(TLanInviteMessage, decoded)) return undefined;
  return decoded as LanInviteMessage;
}

/**
 * typebox cannot express "a Uint8Array" structurally, so the byte-valued fields
 * are checked here before the schema check runs on everything else.
 */
function isBytesShaped(decoded: unknown): boolean {
  if (typeof decoded !== 'object' || decoded === null) return false;
  const record = decoded as Record<string, unknown>;
  for (const field of [
    'offerKey',
    'requesterKey',
    'joinerKey',
    'senderKey',
    'nonce',
    'ciphertext',
  ]) {
    if (field in record && !(record[field] instanceof Uint8Array)) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `yarn vitest run src/renderer/src/lan-invite/protocol.test.ts`
Expected: PASS, 10 tests. If the `Value.Check` on `TBytes` rejects a real `Uint8Array`, widen `TBytes` to `Type.Any()` — `isBytesShaped` is what actually enforces those fields.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lan-invite/protocol.ts src/renderer/src/lan-invite/protocol.test.ts
git commit -m "feat(lan-invite): wire messages that reject anything unrecognised"
```

---

### Task 4: Sealing the invite code

**Files:**

- Create: `src/renderer/src/lan-invite/sealing.ts`
- Test: `src/renderer/src/lan-invite/sealing.test.ts`

**Interfaces:**

- Consumes: `LAN_INVITE_PROTOCOL_VERSION` from Task 3.
- Produces:
  - `type SessionKeys = { publicKeyRaw: Uint8Array; privateKey: CryptoKey }`
  - `generateSessionKeys(): Promise<SessionKeys>`
  - `seal(plaintext: string, recipientPublicKeyRaw: Uint8Array, sender: SessionKeys): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }>`
  - `open(sealed: { nonce: Uint8Array; ciphertext: Uint8Array }, senderPublicKeyRaw: Uint8Array, recipient: SessionKeys): Promise<string | undefined>` — `undefined` on any failure.

Both public keys go into the HKDF salt in a fixed order (sender first, then recipient), so a ciphertext only opens for the pair it was made for. Combined with keys that are fresh per window, that is what stops a captured `invite-sealed` being replayed into a later session.

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/src/lan-invite/sealing.test.ts
import { describe, it, expect } from 'vitest';
import { generateSessionKeys, open, seal } from './sealing.js';

const CODE = 'moss-0.16-hVGhlIHF1aWNrIGJyb3duIGZveA';

describe('seal / open', () => {
  it('lets the intended recipient read the invite code', async () => {
    const sender = await generateSessionKeys();
    const recipient = await generateSessionKeys();
    const sealed = await seal(CODE, recipient.publicKeyRaw, sender);
    expect(await open(sealed, sender.publicKeyRaw, recipient)).toBe(CODE);
  });

  it('yields a public key of the 65 raw bytes a P-256 point takes', async () => {
    const keys = await generateSessionKeys();
    expect(keys.publicKeyRaw.length).toBe(65);
  });

  it('uses a fresh nonce for each sealing, so identical codes do not look identical', async () => {
    const sender = await generateSessionKeys();
    const recipient = await generateSessionKeys();
    const first = await seal(CODE, recipient.publicKeyRaw, sender);
    const second = await seal(CODE, recipient.publicKeyRaw, sender);
    expect(first.nonce).not.toEqual(second.nonce);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });

  it('tells a bystander nothing: a third party cannot open it', async () => {
    const sender = await generateSessionKeys();
    const recipient = await generateSessionKeys();
    const bystander = await generateSessionKeys();
    const sealed = await seal(CODE, recipient.publicKeyRaw, sender);
    expect(await open(sealed, sender.publicKeyRaw, bystander)).toBeUndefined();
  });

  it('refuses a ciphertext attributed to the wrong sender', async () => {
    const sender = await generateSessionKeys();
    const recipient = await generateSessionKeys();
    const impostor = await generateSessionKeys();
    const sealed = await seal(CODE, recipient.publicKeyRaw, sender);
    expect(await open(sealed, impostor.publicKeyRaw, recipient)).toBeUndefined();
  });

  it('refuses a tampered ciphertext', async () => {
    const sender = await generateSessionKeys();
    const recipient = await generateSessionKeys();
    const sealed = await seal(CODE, recipient.publicKeyRaw, sender);
    sealed.ciphertext[0] ^= 0xff;
    expect(await open(sealed, sender.publicKeyRaw, recipient)).toBeUndefined();
  });

  it('refuses a recipient key that is not a point on the curve', async () => {
    const sender = await generateSessionKeys();
    await expect(seal(CODE, new Uint8Array(65).fill(9), sender)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn vitest run src/renderer/src/lan-invite/sealing.test.ts`
Expected: FAIL — cannot resolve `./sealing.js`.

- [ ] **Step 3: Implement**

```typescript
// src/renderer/src/lan-invite/sealing.ts
import { LAN_INVITE_PROTOCOL_VERSION } from './protocol.js';

const CURVE = 'P-256';
const NONCE_BYTES = 12;

/**
 * One ephemeral keypair per advertising window. The private key is
 * non-extractable and never leaves this process; both die when the window does,
 * which is also the whole lifetime of the exposure.
 */
export type SessionKeys = { publicKeyRaw: Uint8Array; privateKey: CryptoKey };

export async function generateSessionKeys(): Promise<SessionKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: CURVE }, false, [
    'deriveBits',
  ]);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return { publicKeyRaw: new Uint8Array(raw), privateKey: pair.privateKey };
}

export async function seal(
  plaintext: string,
  recipientPublicKeyRaw: Uint8Array,
  sender: SessionKeys,
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const key = await sharedKey(
    sender,
    recipientPublicKeyRaw,
    sender.publicKeyRaw,
    recipientPublicKeyRaw,
  );
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { nonce, ciphertext: new Uint8Array(ciphertext) };
}

export async function open(
  sealed: { nonce: Uint8Array; ciphertext: Uint8Array },
  senderPublicKeyRaw: Uint8Array,
  recipient: SessionKeys,
): Promise<string | undefined> {
  try {
    const key = await sharedKey(
      recipient,
      senderPublicKeyRaw,
      senderPublicKeyRaw,
      recipient.publicKeyRaw,
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.nonce },
      key,
      sealed.ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return undefined;
  }
}

/**
 * Binding both public keys into the salt, in sender-then-recipient order, ties a
 * ciphertext to exactly the pair that made it. Because the keys are fresh per
 * window, that also means a captured sealed invite cannot be replayed later.
 */
async function sharedKey(
  own: SessionKeys,
  peerPublicKeyRaw: Uint8Array,
  saltFirst: Uint8Array,
  saltSecond: Uint8Array,
): Promise<CryptoKey> {
  const peerKey = await crypto.subtle.importKey(
    'raw',
    peerPublicKeyRaw,
    { name: 'ECDH', namedCurve: CURVE },
    false,
    [],
  );
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerKey },
    own.privateKey,
    256,
  );
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array(saltFirst.length + saltSecond.length);
  salt.set(saltFirst, 0);
  salt.set(saltSecond, saltFirst.length);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode(
        `moss-lan-invite/${LAN_INVITE_PROTOCOL_VERSION}/invite-sealed`,
      ),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `yarn vitest run src/renderer/src/lan-invite/sealing.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lan-invite/sealing.ts src/renderer/src/lan-invite/sealing.test.ts
git commit -m "feat(lan-invite): seal an invite code to one ephemeral key"
```

---

### Task 5: The multicast socket

**Files:**

- Create: `src/main/lanBeacon/socket.ts`
- Test: `src/main/lanBeacon/socket.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `LAN_INVITE_MULTICAST_ADDRESS = '239.255.76.67'`, `LAN_INVITE_PORT = 47654`
  - `type BeaconSocket` with `broadcast(payload: Uint8Array): void`, `unicast(payload: Uint8Array, address: string, port: number): void`, `joinedInterfaces(): string[]`, `close(): Promise<void>`
  - `type DatagramHandler = (payload: Uint8Array, remoteAddress: string, remotePort: number) => void`
  - `openBeaconSocket(onDatagram: DatagramHandler): Promise<BeaconSocket>`

`broadcast` sends twice: once to the multicast group, once to each interface's directed broadcast address. Some access points — phone hotspots especially — pass broadcast where they drop multicast group traffic, and the listener already collapses a window's repeats by `sid`, so the duplicate costs nothing.

Multicast loopback stays on so that dev mode's two or three agents on one machine can see each other; that is also how most manual testing happens.

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/lanBeacon/socket.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { LAN_INVITE_PORT, openBeaconSocket, type BeaconSocket } from './socket.js';

const opened: BeaconSocket[] = [];

async function open(onDatagram: Parameters<typeof openBeaconSocket>[0]): Promise<BeaconSocket> {
  const socket = await openBeaconSocket(onDatagram);
  opened.push(socket);
  return socket;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => s.close()));
});

/** Resolves with the first payload the socket receives, or rejects after 2s. */
function firstDatagram(): { promise: Promise<Uint8Array>; handler: (p: Uint8Array) => void } {
  let settle: (payload: Uint8Array) => void;
  let fail: (error: Error) => void;
  const promise = new Promise<Uint8Array>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const timer = setTimeout(() => fail(new Error('no datagram within 2s')), 2000);
  return {
    promise,
    handler: (payload) => {
      clearTimeout(timer);
      settle(payload);
    },
  };
}

describe('openBeaconSocket', () => {
  it('reports the interfaces it joined the group on', async () => {
    const socket = await open(() => {});
    expect(Array.isArray(socket.joinedInterfaces())).toBe(true);
  });

  it('delivers a broadcast payload to a listener on this machine', async () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const inbox = firstDatagram();
    await open(inbox.handler);
    const sender = await open(() => {});
    sender.broadcast(payload);
    expect(await inbox.promise).toEqual(payload);
  });

  it('delivers a unicast payload to a given address and port', async () => {
    // One socket, sending to itself: with two sockets sharing the port, which
    // one the kernel hands a unicast datagram to is not defined.
    const payload = new Uint8Array([9, 9, 9]);
    const inbox = firstDatagram();
    const socket = await open(inbox.handler);
    socket.unicast(payload, '127.0.0.1', LAN_INVITE_PORT);
    expect(await inbox.promise).toEqual(payload);
  });

  it('closes cleanly, and closing twice is not an error', async () => {
    const socket = await open(() => {});
    await socket.close();
    await expect(socket.close()).resolves.toBeUndefined();
  });
});
```

Note for the implementer: these are real sockets. If the environment forbids multicast or the port is taken, the two delivery tests fail with a timeout rather than an assertion. Wrap the describe in the guard from Step 3's note rather than deleting them.

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn vitest run src/main/lanBeacon/socket.test.ts`
Expected: FAIL — cannot resolve `./socket.js`.

- [ ] **Step 3: Implement**

```typescript
// src/main/lanBeacon/socket.ts
import dgram from 'node:dgram';
import os from 'node:os';

/**
 * An administratively scoped multicast group and a port of our own. TTL 1 keeps
 * every beacon on the local link regardless of scope.
 */
export const LAN_INVITE_MULTICAST_ADDRESS = '239.255.76.67';
export const LAN_INVITE_PORT = 47654;

export type DatagramHandler = (
  payload: Uint8Array,
  remoteAddress: string,
  remotePort: number,
) => void;

export type BeaconSocket = {
  broadcast(payload: Uint8Array): void;
  unicast(payload: Uint8Array, address: string, port: number): void;
  joinedInterfaces(): string[];
  close(): Promise<void>;
};

type Ipv4Interface = { name: string; address: string; broadcast: string };

export async function openBeaconSocket(onDatagram: DatagramHandler): Promise<BeaconSocket> {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const joined: string[] = [];
  let closed = false;

  socket.on('message', (message, rinfo) => {
    onDatagram(new Uint8Array(message), rinfo.address, rinfo.port);
  });
  // A hostile or merely noisy network should not be able to take the app down.
  socket.on('error', () => {});

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(LAN_INVITE_PORT, () => {
      socket.removeListener('error', reject);
      resolve();
    });
  });

  socket.setBroadcast(true);
  socket.setMulticastTTL(1);
  // On so that several agents on one developer machine can find each other.
  socket.setMulticastLoopback(true);

  // Joining on a single OS-chosen interface is the classic failure on machines
  // with a VPN, a docker bridge, or both ethernet and wifi up.
  for (const iface of ipv4Interfaces()) {
    try {
      socket.addMembership(LAN_INVITE_MULTICAST_ADDRESS, iface.address);
      joined.push(iface.name);
    } catch {
      // An interface that refuses the group is not a reason to give up on the rest.
    }
  }

  return {
    broadcast(payload) {
      if (closed) return;
      send(socket, payload, LAN_INVITE_MULTICAST_ADDRESS, LAN_INVITE_PORT);
      for (const iface of ipv4Interfaces()) {
        send(socket, payload, iface.broadcast, LAN_INVITE_PORT);
      }
    },
    unicast(payload, address, port) {
      if (closed) return;
      send(socket, payload, address, port);
    },
    joinedInterfaces: () => [...joined],
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve) => socket.close(() => resolve()));
    },
  };
}

function send(socket: dgram.Socket, payload: Uint8Array, address: string, port: number): void {
  socket.send(payload, port, address, () => {});
}

function ipv4Interfaces(): Ipv4Interface[] {
  const found: Ipv4Interface[] = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      found.push({
        name,
        address: address.address,
        broadcast: broadcastAddress(address.address, address.netmask),
      });
    }
  }
  return found;
}

function broadcastAddress(address: string, netmask: string): string {
  const host = address.split('.').map(Number);
  const mask = netmask.split('.').map(Number);
  return host.map((octet, i) => (octet & mask[i]) | (~mask[i] & 0xff)).join('.');
}
```

If the sandbox running the tests blocks multicast, guard the two delivery tests with `const canMulticast = process.env.CI !== 'true';` and `it.skipIf(!canMulticast)`, and say so in the skip message. Do not delete them — they are the only coverage of the part that talks to a real network.

- [ ] **Step 4: Run the test and watch it pass**

Run: `yarn vitest run src/main/lanBeacon/socket.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/lanBeacon/socket.ts src/main/lanBeacon/socket.test.ts
git commit -m "feat(lan-invite): a link-local socket that joins every interface"
```

---

### Task 6: The beacon pipe

**Files:**

- Create: `src/main/lanBeacon/pipe.ts`
- Test: `src/main/lanBeacon/pipe.test.ts`

**Interfaces:**

- Consumes: `BeaconSocket` from Task 5.
- Produces:
  - `BEACON_INTERVAL_MS = 3000`
  - `type BeaconDiagnostics = { bound: boolean; interfaces: string[]; advertising: boolean; received: number; dropped: number }`
  - `type BeaconPipe` with `startAdvertising(payload: Uint8Array, untilMs: number): void`, `stopAdvertising(): void`, `unicast(payload, address, port): void`, `deliver(payload, address, port): void`, `diagnostics(): BeaconDiagnostics`, `stop(): void`
  - `createBeaconPipe(deps: { socket: BeaconSocket; now: () => number; setInterval: …; clearInterval: …; onDatagram: (payload: Uint8Array, address: string, port: number) => void }): BeaconPipe`

All timing and counting lives here, behind injected clock and timer functions, so the whole thing is testable without waiting on wall time. `deliver` is what the socket's datagram handler calls; it applies the rate limit and the size cap before forwarding.

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/lanBeacon/pipe.test.ts
import { describe, it, expect } from 'vitest';
import { BEACON_INTERVAL_MS, createBeaconPipe } from './pipe.js';

function harness() {
  const sent: Uint8Array[] = [];
  const unicast: { payload: Uint8Array; address: string; port: number }[] = [];
  const forwarded: { payload: Uint8Array; address: string }[] = [];
  let clock = 0;
  const timers: (() => void)[] = [];

  const pipe = createBeaconPipe({
    socket: {
      broadcast: (payload) => sent.push(payload),
      unicast: (payload, address, port) => unicast.push({ payload, address, port }),
      joinedInterfaces: () => ['eth0'],
      close: () => Promise.resolve(),
    },
    now: () => clock,
    setInterval: (fn: () => void) => {
      timers.push(fn);
      return timers.length as unknown as NodeJS.Timeout;
    },
    clearInterval: () => timers.splice(0),
    onDatagram: (payload, address) => forwarded.push({ payload, address }),
  });

  return {
    pipe,
    sent,
    unicast,
    forwarded,
    advance(ms: number) {
      clock += ms;
      for (const fire of [...timers]) fire();
    },
  };
}

const PAYLOAD = new Uint8Array([1, 2, 3]);

describe('createBeaconPipe', () => {
  it('sends the first beacon immediately rather than after one interval', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    expect(h.sent).toEqual([PAYLOAD]);
  });

  it('repeats the beacon on every interval while the window is open', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    h.advance(BEACON_INTERVAL_MS);
    h.advance(BEACON_INTERVAL_MS);
    expect(h.sent.length).toBe(3);
  });

  it('stops on its own when the deadline passes', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 5_000);
    h.advance(6_000);
    const afterDeadline = h.sent.length;
    h.advance(BEACON_INTERVAL_MS);
    expect(h.sent.length).toBe(afterDeadline);
    expect(h.pipe.diagnostics().advertising).toBe(false);
  });

  it('stops when asked', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    h.pipe.stopAdvertising();
    h.advance(BEACON_INTERVAL_MS);
    expect(h.sent.length).toBe(1);
  });

  it('replaces an advertisement rather than running two at once', () => {
    const h = harness();
    const second = new Uint8Array([4, 5, 6]);
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    h.pipe.startAdvertising(second, 60_000);
    h.sent.length = 0;
    h.advance(BEACON_INTERVAL_MS);
    expect(h.sent).toEqual([second]);
  });

  it('forwards an inbound datagram', () => {
    const h = harness();
    h.pipe.deliver(PAYLOAD, '192.168.1.5', 47654);
    expect(h.forwarded).toEqual([{ payload: PAYLOAD, address: '192.168.1.5' }]);
  });

  it('drops an oversize datagram instead of forwarding it', () => {
    const h = harness();
    h.pipe.deliver(new Uint8Array(4096), '192.168.1.5', 47654);
    expect(h.forwarded).toEqual([]);
    expect(h.pipe.diagnostics().dropped).toBe(1);
  });

  it('drops datagrams past the rate limit so a flood cannot swamp the renderer', () => {
    const h = harness();
    for (let i = 0; i < 200; i++) h.pipe.deliver(PAYLOAD, '192.168.1.5', 47654);
    expect(h.forwarded.length).toBeLessThan(200);
    expect(h.pipe.diagnostics().dropped).toBeGreaterThan(0);
  });

  it('lets traffic through again once the rate-limit window has passed', () => {
    const h = harness();
    for (let i = 0; i < 200; i++) h.pipe.deliver(PAYLOAD, '192.168.1.5', 47654);
    const beforeWait = h.forwarded.length;
    h.advance(1_000);
    h.pipe.deliver(PAYLOAD, '192.168.1.5', 47654);
    expect(h.forwarded.length).toBe(beforeWait + 1);
  });

  it('reports what the diagnostics pane needs', () => {
    const h = harness();
    h.pipe.startAdvertising(PAYLOAD, 60_000);
    h.pipe.deliver(PAYLOAD, '192.168.1.5', 47654);
    expect(h.pipe.diagnostics()).toEqual({
      bound: true,
      interfaces: ['eth0'],
      advertising: true,
      received: 1,
      dropped: 0,
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn vitest run src/main/lanBeacon/pipe.test.ts`
Expected: FAIL — cannot resolve `./pipe.js`.

- [ ] **Step 3: Implement**

```typescript
// src/main/lanBeacon/pipe.ts
import { MAX_DATAGRAM_BYTES } from './limits.js';
import type { BeaconSocket } from './socket.js';

/** Frequent enough that someone watching a list sees an arrival as it happens. */
export const BEACON_INTERVAL_MS = 3000;

const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_PER_WINDOW = 60;

export type BeaconDiagnostics = {
  bound: boolean;
  interfaces: string[];
  advertising: boolean;
  received: number;
  dropped: number;
};

export type BeaconPipe = {
  startAdvertising(payload: Uint8Array, durationMs: number): void;
  stopAdvertising(): void;
  unicast(payload: Uint8Array, address: string, port: number): void;
  deliver(payload: Uint8Array, address: string, port: number): void;
  diagnostics(): BeaconDiagnostics;
  stop(): void;
};

export type BeaconPipeDeps = {
  socket: BeaconSocket;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval: (handle: NodeJS.Timeout) => void;
  onDatagram: (payload: Uint8Array, address: string, port: number) => void;
};

export function createBeaconPipe(deps: BeaconPipeDeps): BeaconPipe {
  let advertisement: { payload: Uint8Array; deadline: number } | undefined;
  let handle: NodeJS.Timeout | undefined;
  let received = 0;
  let dropped = 0;
  let windowStart = deps.now();
  let inWindow = 0;

  function stopAdvertising(): void {
    advertisement = undefined;
    if (handle !== undefined) {
      deps.clearInterval(handle);
      handle = undefined;
    }
  }

  function tick(): void {
    if (!advertisement) return;
    if (deps.now() >= advertisement.deadline) {
      stopAdvertising();
      return;
    }
    deps.socket.broadcast(advertisement.payload);
  }

  return {
    startAdvertising(payload, durationMs) {
      stopAdvertising();
      advertisement = { payload, deadline: deps.now() + durationMs };
      // Send at once: waiting a full interval makes the button feel broken.
      deps.socket.broadcast(payload);
      handle = deps.setInterval(tick, BEACON_INTERVAL_MS);
    },
    stopAdvertising,
    unicast(payload, address, port) {
      deps.socket.unicast(payload, address, port);
    },
    deliver(payload, address, port) {
      if (payload.length > MAX_DATAGRAM_BYTES) {
        dropped++;
        return;
      }
      const now = deps.now();
      if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
        windowStart = now;
        inWindow = 0;
      }
      if (inWindow >= RATE_LIMIT_PER_WINDOW) {
        dropped++;
        return;
      }
      inWindow++;
      received++;
      deps.onDatagram(payload, address, port);
    },
    diagnostics: () => ({
      bound: true,
      interfaces: deps.socket.joinedInterfaces(),
      advertising: advertisement !== undefined,
      received,
      dropped,
    }),
    stop() {
      stopAdvertising();
    },
  };
}
```

Also create `src/main/lanBeacon/limits.ts`, so that main does not import from the renderer tree:

```typescript
// src/main/lanBeacon/limits.ts
/**
 * Mirrors MAX_DATAGRAM_BYTES in the renderer's protocol module. The two
 * processes share no code, and main needs the cap before it forwards anything.
 */
export const MAX_DATAGRAM_BYTES = 1200;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `yarn vitest run src/main/lanBeacon/pipe.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/lanBeacon/pipe.ts src/main/lanBeacon/limits.ts src/main/lanBeacon/pipe.test.ts
git commit -m "feat(lan-invite): repeat a beacon on a schedule and bound what comes back"
```

---

### Task 7: The main-process service and its IPC surface

**Files:**

- Create: `src/main/lanBeacon/index.ts`
- Modify: `src/main/index.ts` (handlers, alongside the other `ipcMain.handle` registrations near the tool-transfer ones around line 2470)
- Modify: `src/preload/admin.ts` (bridge, alongside the other `ipcRenderer.invoke` entries)
- Modify: `src/renderer/src/electron-api.ts` (types)

**Interfaces:**

- Consumes: `openBeaconSocket` (Task 5), `createBeaconPipe` and `BeaconDiagnostics` (Task 6).
- Produces on `window.electronAPI`:
  - `lanBeaconSetListening(listening: boolean): Promise<void>`
  - `lanBeaconStartAdvertising(payload: Uint8Array, durationMs: number): Promise<void>`
  - `lanBeaconStopAdvertising(): Promise<void>`
  - `lanBeaconUnicast(payload: Uint8Array, address: string, port: number): Promise<void>`
  - `lanBeaconDiagnostics(): Promise<BeaconDiagnostics>`
  - `onLanBeaconDatagram(callback: (e: any, payload: { bytes: Uint8Array; address: string; port: number }) => any): void`

The socket is opened on the first `lanBeaconSetListening(true)`, not at app start: binding at launch would raise the macOS Local Network prompt and the Windows firewall dialog on every cold start, for a feature most sessions never use.

There is no unit test for this task — it is wiring. The guard is `src/main/ipc-contract-drift.test.ts`, which fails if a channel exists on one side only, plus `yarn typecheck`.

- [ ] **Step 1: Write the service**

```typescript
// src/main/lanBeacon/index.ts
import { createBeaconPipe, type BeaconDiagnostics, type BeaconPipe } from './pipe.js';
import { openBeaconSocket, type BeaconSocket } from './socket.js';

export type { BeaconDiagnostics } from './pipe.js';

export type LanBeaconService = {
  setListening(listening: boolean, onDatagram: DatagramForwarder): Promise<void>;
  startAdvertising(payload: Uint8Array, durationMs: number): void;
  stopAdvertising(): void;
  unicast(payload: Uint8Array, address: string, port: number): void;
  diagnostics(): BeaconDiagnostics;
  shutdown(): Promise<void>;
};

export type DatagramForwarder = (payload: Uint8Array, address: string, port: number) => void;

const IDLE: BeaconDiagnostics = {
  bound: false,
  interfaces: [],
  advertising: false,
  received: 0,
  dropped: 0,
};

/**
 * The socket is opened only once something asks to listen. Binding at launch
 * would raise the macOS local-network prompt and the Windows firewall dialog on
 * every cold start, for a feature most sessions never touch.
 */
export function createLanBeaconService(): LanBeaconService {
  let socket: BeaconSocket | undefined;
  let pipe: BeaconPipe | undefined;

  async function close(): Promise<void> {
    pipe?.stop();
    pipe = undefined;
    await socket?.close();
    socket = undefined;
  }

  return {
    async setListening(listening, onDatagram) {
      if (!listening) {
        await close();
        return;
      }
      if (pipe) return;
      socket = await openBeaconSocket((payload, address, port) =>
        pipe?.deliver(payload, address, port),
      );
      pipe = createBeaconPipe({
        socket,
        now: () => Date.now(),
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: (handle) => clearInterval(handle),
        onDatagram,
      });
    },
    startAdvertising: (payload, durationMs) => pipe?.startAdvertising(payload, durationMs),
    stopAdvertising: () => pipe?.stopAdvertising(),
    unicast: (payload, address, port) => pipe?.unicast(payload, address, port),
    diagnostics: () => pipe?.diagnostics() ?? IDLE,
    shutdown: close,
  };
}
```

- [ ] **Step 2: Register the handlers**

In `src/main/index.ts`, import the service and instantiate it once alongside the other module-level state, then register five handlers next to the tool-transfer ones:

```typescript
import { createLanBeaconService, type BeaconDiagnostics } from './lanBeacon/index.js';

const LAN_BEACON = createLanBeaconService();
```

```typescript
ipcMain.handle('lan-beacon-set-listening', async (_e, listening: boolean): Promise<void> => {
  await LAN_BEACON.setListening(listening, (bytes, address, port) => {
    if (MAIN_WINDOW) emitToWindow(MAIN_WINDOW, 'lan-beacon-datagram', { bytes, address, port });
  });
});
ipcMain.handle(
  'lan-beacon-start-advertising',
  async (_e, payload: Uint8Array, durationMs: number): Promise<void> =>
    LAN_BEACON.startAdvertising(payload, durationMs),
);
ipcMain.handle(
  'lan-beacon-stop-advertising',
  async (): Promise<void> => LAN_BEACON.stopAdvertising(),
);
ipcMain.handle(
  'lan-beacon-unicast',
  async (_e, payload: Uint8Array, address: string, port: number): Promise<void> =>
    LAN_BEACON.unicast(payload, address, port),
);
ipcMain.handle(
  'lan-beacon-diagnostics',
  async (): Promise<BeaconDiagnostics> => LAN_BEACON.diagnostics(),
);
```

Find the existing `app.on('before-quit', …)` (or the equivalent shutdown path where lair and holochain are torn down) and add `await LAN_BEACON.shutdown();` so the socket does not outlive the app.

- [ ] **Step 3: Bridge them in the preload**

In `src/preload/admin.ts`, add to the exposed object:

```typescript
  lanBeaconSetListening: (listening: boolean) =>
    ipcRenderer.invoke('lan-beacon-set-listening', listening),
  lanBeaconStartAdvertising: (payload: Uint8Array, durationMs: number) =>
    ipcRenderer.invoke('lan-beacon-start-advertising', payload, durationMs),
  lanBeaconStopAdvertising: () => ipcRenderer.invoke('lan-beacon-stop-advertising'),
  lanBeaconUnicast: (payload: Uint8Array, address: string, port: number) =>
    ipcRenderer.invoke('lan-beacon-unicast', payload, address, port),
  lanBeaconDiagnostics: () => ipcRenderer.invoke('lan-beacon-diagnostics'),
  onLanBeaconDatagram: (
    callback: (
      e: Electron.IpcRendererEvent,
      payload: { bytes: Uint8Array; address: string; port: number },
    ) => any,
  ) => ipcRenderer.on('lan-beacon-datagram', callback),
```

- [ ] **Step 4: Declare them in the renderer's typed view**

In `src/renderer/src/electron-api.ts`, add to the `electronAPI` interface:

```typescript
      lanBeaconSetListening: (listening: boolean) => Promise<void>;
      lanBeaconStartAdvertising: (payload: Uint8Array, durationMs: number) => Promise<void>;
      lanBeaconStopAdvertising: () => Promise<void>;
      lanBeaconUnicast: (payload: Uint8Array, address: string, port: number) => Promise<void>;
      lanBeaconDiagnostics: () => Promise<{
        bound: boolean;
        interfaces: string[];
        advertising: boolean;
        received: number;
        dropped: number;
      }>;
      onLanBeaconDatagram: (
        callback: (
          e: any,
          payload: { bytes: Uint8Array; address: string; port: number },
        ) => any,
      ) => void;
```

- [ ] **Step 5: Verify the contract holds**

Run: `yarn vitest run src/main/ipc-contract-drift.test.ts && yarn typecheck`
Expected: PASS, and typecheck clean. A failure here names the channel that exists on only one side.

- [ ] **Step 6: Commit**

```bash
git add src/main/lanBeacon/index.ts src/main/index.ts src/preload/admin.ts src/renderer/src/electron-api.ts
git commit -m "feat(lan-invite): expose the beacon pipe to the renderer"
```

---

### Task 8: Presence — heard intents and flow B

**Files:**

- Create: `src/renderer/src/lan-invite/presence.ts`
- Test: `src/renderer/src/lan-invite/presence.test.ts`

**Interfaces:**

- Consumes: `encodeMessage`, `decodeMessage`, `LAN_INVITE_PROTOCOL_VERSION` (Task 3); `generateSessionKeys`, `seal`, `open` (Task 4); `nameFromPublicKey`, `duplicateNames` (Task 2).
- Produces:
  - `HEARD_TTL_MS = 10_000`, `MAX_HEARD = 50`
  - `type HeardIntent = { sid: string; name: string; ambiguous: boolean; lastSeen: number }`
  - `type PresenceDeps = { now: () => number; advertise: (payload: Uint8Array, durationMs: number) => void; stopAdvertising: () => void; unicast: (payload: Uint8Array, address: string, port: number) => void; onInvite: (invite: { code: string; groupName: string }) => void; onChange: () => void }`
  - `type Presence` with `receive`, `advertiseIntent`, `stopIntent`, `admit`, `heardIntents`, `expire`
  - `createPresence(deps: PresenceDeps): Presence`

Everything about time and I/O is injected, so a test drives both sides of a real exchange in one process without touching a socket.

The member seals with a keypair generated per `admit` call. The newcomer cannot authenticate that sender — it has heard no prior key from them — which is why the UI shows the group name for confirmation rather than joining silently.

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/src/lan-invite/presence.test.ts
import { describe, it, expect } from 'vitest';
import { decodeMessage, encodeMessage } from './protocol.js';
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
  it('gives the newcomer a three-word name to say out loud', async () => {
    const newcomer = node();
    const name = await newcomer.presence.advertiseIntent(60_000);
    expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+$/);
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
    await member.presence.admit([heard.sid], CODE, 'Team Standup');

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
    await member.presence.admit(sids, CODE, 'Team Standup');
    expect(member.unicasts.map((u) => u.address).sort()).toEqual(['192.168.1.10', '192.168.1.9']);
  });

  it('stops broadcasting when the newcomer withdraws', async () => {
    const newcomer = node();
    await newcomer.presence.advertiseIntent(60_000);
    newcomer.presence.stopIntent();
    expect(newcomer.advertised).toBeUndefined();
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

    await member.presence.admit(
      heard.map((i) => i.sid),
      CODE,
      'Team Standup',
    );
    expect(member.unicasts).toEqual([]);
  });
});

/** Re-encodes a join intent under a new session id, keeping its key. */
function decodeAndRelabel(bytes: Uint8Array): Uint8Array {
  const message = decodeMessage(bytes);
  if (!message || message.kind !== 'join-intent') throw new Error('expected a join intent');
  return encodeMessage({ ...message, sid: 'twin-session' });
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn vitest run src/renderer/src/lan-invite/presence.test.ts`
Expected: FAIL — cannot resolve `./presence.js`.

- [ ] **Step 3: Implement**

```typescript
// src/renderer/src/lan-invite/presence.ts
import { duplicateNames, nameFromPublicKey } from './naming.js';
import {
  decodeMessage,
  encodeMessage,
  LAN_INVITE_PROTOCOL_VERSION,
  type JoinIntent,
} from './protocol.js';
import { generateSessionKeys, open, seal, type SessionKeys } from './sealing.js';

/** Three missed beacons at the 3s cadence: gone from the room, not merely quiet. */
export const HEARD_TTL_MS = 10_000;

/** A flooded network should cost a long list, not unbounded memory. */
export const MAX_HEARD = 50;

export type HeardIntent = { sid: string; name: string; ambiguous: boolean; lastSeen: number };

export type PresenceDeps = {
  now: () => number;
  advertise: (payload: Uint8Array, durationMs: number) => void;
  stopAdvertising: () => void;
  unicast: (payload: Uint8Array, address: string, port: number) => void;
  onInvite: (invite: { code: string; groupName: string }) => void;
  onChange: () => void;
};

export type Presence = {
  receive(bytes: Uint8Array, address: string, port: number): Promise<void>;
  advertiseIntent(durationMs: number): Promise<string>;
  stopIntent(): void;
  admit(sids: readonly string[], inviteCode: string, groupName: string): Promise<void>;
  heardIntents(): HeardIntent[];
  expire(): void;
};

type IntentRecord = {
  sid: string;
  joinerKey: Uint8Array;
  name: string;
  address: string;
  port: number;
  lastSeen: number;
};

type IntentSession = { sid: string; keys: SessionKeys };

export function createPresence(deps: PresenceDeps): Presence {
  const heard = new Map<string, IntentRecord>();
  let intentSession: IntentSession | undefined;

  function changed(): void {
    deps.onChange();
  }

  function prune(): void {
    const cutoff = deps.now() - HEARD_TTL_MS;
    for (const [sid, record] of heard) {
      if (record.lastSeen <= cutoff) heard.delete(sid);
    }
  }

  async function noteIntent(message: JoinIntent, address: string, port: number): Promise<void> {
    const existing = heard.get(message.sid);
    if (existing) {
      existing.lastSeen = deps.now();
      existing.address = address;
      existing.port = port;
      return;
    }
    prune();
    if (heard.size >= MAX_HEARD) return;
    heard.set(message.sid, {
      sid: message.sid,
      joinerKey: message.joinerKey,
      name: await nameFromPublicKey(message.joinerKey),
      address,
      port,
      lastSeen: deps.now(),
    });
    changed();
  }

  function ambiguousNames(): ReadonlySet<string> {
    return duplicateNames([...heard.values()].map((record) => record.name));
  }

  return {
    async receive(bytes, address, port) {
      const message = decodeMessage(bytes);
      if (!message) return;
      if (message.kind === 'join-intent') {
        await noteIntent(message, address, port);
        return;
      }
      if (message.kind === 'invite-sealed') {
        if (!intentSession || intentSession.sid !== message.sid) return;
        const plaintext = await open(
          { nonce: message.nonce, ciphertext: message.ciphertext },
          message.senderKey,
          intentSession.keys,
        );
        if (!plaintext) return;
        const invite = parseInvite(plaintext);
        if (!invite) return;
        deps.onInvite(invite);
        changed();
      }
    },

    async advertiseIntent(durationMs) {
      const keys = await generateSessionKeys();
      const sid = randomSid();
      intentSession = { sid, keys };
      const beacon = encodeMessage({
        v: LAN_INVITE_PROTOCOL_VERSION,
        kind: 'join-intent',
        sid,
        joinerKey: keys.publicKeyRaw,
      });
      deps.advertise(beacon, durationMs);
      changed();
      return nameFromPublicKey(keys.publicKeyRaw);
    },

    stopIntent() {
      intentSession = undefined;
      deps.stopAdvertising();
      changed();
    },

    async admit(sids, inviteCode, groupName) {
      const ambiguous = ambiguousNames();
      for (const sid of sids) {
        const record = heard.get(sid);
        // A name two beacons share cannot identify a person, so it is never
        // sealed to. The list shows why.
        if (!record || ambiguous.has(record.name)) continue;
        const keys = await generateSessionKeys();
        const sealed = await seal(formatInvite(inviteCode, groupName), record.joinerKey, keys);
        deps.unicast(
          encodeMessage({
            v: LAN_INVITE_PROTOCOL_VERSION,
            kind: 'invite-sealed',
            sid: record.sid,
            senderKey: keys.publicKeyRaw,
            nonce: sealed.nonce,
            ciphertext: sealed.ciphertext,
          }),
          record.address,
          record.port,
        );
      }
    },

    heardIntents() {
      prune();
      const ambiguous = ambiguousNames();
      return [...heard.values()]
        .map((record) => ({
          sid: record.sid,
          name: record.name,
          ambiguous: ambiguous.has(record.name),
          lastSeen: record.lastSeen,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    expire() {
      const before = heard.size;
      prune();
      if (heard.size !== before) changed();
    },
  };
}

function randomSid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The group name travels with the code so the recipient can see what they are joining. */
function formatInvite(code: string, groupName: string): string {
  return JSON.stringify({ code, groupName });
}

function parseInvite(plaintext: string): { code: string; groupName: string } | undefined {
  try {
    const parsed = JSON.parse(plaintext) as { code?: unknown; groupName?: unknown };
    if (typeof parsed.code !== 'string' || typeof parsed.groupName !== 'string') return undefined;
    return { code: parsed.code, groupName: parsed.groupName };
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `yarn vitest run src/renderer/src/lan-invite/presence.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lan-invite/presence.ts src/renderer/src/lan-invite/presence.test.ts
git commit -m "feat(lan-invite): hear join intents and seal an invite to the one chosen"
```

---

### Task 9: The renderer-side session

**Files:**

- Create: `src/renderer/src/lan-invite/lan-invite-session.ts`
- Test: `src/renderer/src/lan-invite/lan-invite-session.test.ts`

**Interfaces:**

- Consumes: `createPresence`, `HeardIntent` (Task 8); the `electronAPI` methods from Task 7.
- Produces:
  - `type LanBeaconApi` — the narrow slice of `window.electronAPI` this needs, so tests can pass a fake:
    `{ lanBeaconSetListening; lanBeaconStartAdvertising; lanBeaconStopAdvertising; lanBeaconUnicast; onLanBeaconDatagram }`
  - `class LanInviteSession` with `open(): Promise<void>`, `close(): Promise<void>`, `advertiseIntent(durationMs): Promise<string>`, `stopIntent(): void`, `admit(sids, inviteCode, groupName): Promise<void>`, and readonly stores `intents: Writable<HeardIntent[]>`, `receivedInvite: Writable<{ code: string; groupName: string } | undefined>`, `myName: Writable<string | undefined>`.

One session object is created per dialog that needs it and closed when that dialog closes — that is what turns the socket off and what makes the whole thing ephemeral. `open()` starts listening; `close()` stops advertising, stops listening, and clears every store.

The expiry tick lives here, on a 2-second `setInterval`, because a heard entry has to disappear from the list on its own when someone leaves the room.

- [ ] **Step 1: Write the failing test**

```typescript
// src/renderer/src/lan-invite/lan-invite-session.test.ts
import { describe, it, expect, vi } from 'vitest';
import { get } from '@holochain-open-dev/stores';
import { LanInviteSession, type LanBeaconApi } from './lan-invite-session.js';

function fakeApi() {
  const state = {
    listening: false,
    advertised: undefined as Uint8Array | undefined,
    unicasts: [] as { payload: Uint8Array; address: string }[],
    handler: undefined as
      | ((e: unknown, p: { bytes: Uint8Array; address: string; port: number }) => void)
      | undefined,
  };
  const api: LanBeaconApi = {
    lanBeaconSetListening: async (listening) => {
      state.listening = listening;
    },
    lanBeaconStartAdvertising: async (payload) => {
      state.advertised = payload;
    },
    lanBeaconStopAdvertising: async () => {
      state.advertised = undefined;
    },
    lanBeaconUnicast: async (payload, address) => {
      state.unicasts.push({ payload, address });
    },
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

    await vi.waitFor(() => expect(get(member.intents).length).toBe(1));
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
});
```

The third test reads the real beacon the newcomer produced out of its own fake, rather than hand-building one — that is what makes it a test of the two halves fitting together.

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn vitest run src/renderer/src/lan-invite/lan-invite-session.test.ts`
Expected: FAIL — cannot resolve `./lan-invite-session.js`.

- [ ] **Step 3: Implement**

```typescript
// src/renderer/src/lan-invite/lan-invite-session.ts
import { writable, type Writable } from '@holochain-open-dev/stores';

import { createPresence, type HeardIntent, type Presence } from './presence.js';

const EXPIRY_TICK_MS = 2000;

/** The slice of the preload bridge this needs, named so a test can stand in for it. */
export type LanBeaconApi = {
  lanBeaconSetListening: (listening: boolean) => Promise<void>;
  lanBeaconStartAdvertising: (payload: Uint8Array, durationMs: number) => Promise<void>;
  lanBeaconStopAdvertising: () => Promise<void>;
  lanBeaconUnicast: (payload: Uint8Array, address: string, port: number) => Promise<void>;
  onLanBeaconDatagram: (
    callback: (e: unknown, payload: { bytes: Uint8Array; address: string; port: number }) => void,
  ) => void;
};

/**
 * One session per dialog. Opening it turns the socket on; closing it turns the
 * socket off and drops every key and every heard entry, which is what makes the
 * whole exchange ephemeral.
 */
export class LanInviteSession {
  readonly intents: Writable<HeardIntent[]> = writable([]);
  readonly receivedInvite: Writable<{ code: string; groupName: string } | undefined> =
    writable(undefined);
  readonly myName: Writable<string | undefined> = writable(undefined);

  private presence: Presence;
  private tick: ReturnType<typeof setInterval> | undefined;
  private listening = false;

  constructor(private api: LanBeaconApi) {
    this.presence = createPresence({
      now: () => Date.now(),
      advertise: (payload, durationMs) => {
        void this.api.lanBeaconStartAdvertising(payload, durationMs);
      },
      stopAdvertising: () => {
        void this.api.lanBeaconStopAdvertising();
      },
      unicast: (payload, address, port) => {
        void this.api.lanBeaconUnicast(payload, address, port);
      },
      onInvite: (invite) => this.receivedInvite.set(invite),
      onChange: () => this.intents.set(this.presence.heardIntents()),
    });
  }

  async open(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    this.api.onLanBeaconDatagram((_e, payload) => {
      void this.presence.receive(payload.bytes, payload.address, payload.port);
    });
    await this.api.lanBeaconSetListening(true);
    this.tick = setInterval(() => {
      this.presence.expire();
      this.intents.set(this.presence.heardIntents());
    }, EXPIRY_TICK_MS);
  }

  async close(): Promise<void> {
    if (this.tick !== undefined) {
      clearInterval(this.tick);
      this.tick = undefined;
    }
    this.presence.stopIntent();
    await this.api.lanBeaconStopAdvertising();
    await this.api.lanBeaconSetListening(false);
    this.listening = false;
    this.intents.set([]);
    this.receivedInvite.set(undefined);
    this.myName.set(undefined);
  }

  async advertiseIntent(durationMs: number): Promise<string> {
    const name = await this.presence.advertiseIntent(durationMs);
    this.myName.set(name);
    return name;
  }

  stopIntent(): void {
    this.presence.stopIntent();
    this.myName.set(undefined);
  }

  async admit(sids: readonly string[], inviteCode: string, groupName: string): Promise<void> {
    await this.presence.admit(sids, inviteCode, groupName);
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `yarn vitest run src/renderer/src/lan-invite/lan-invite-session.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lan-invite/lan-invite-session.ts src/renderer/src/lan-invite/lan-invite-session.test.ts
git commit -m "feat(lan-invite): a session that lives and dies with its dialog"
```

---

### Task 10: The newcomer asks to be let in

**Files:**

- Create: `src/renderer/src/app/dialogs/local-network-join.ts`
- Modify: `src/renderer/src/app/dialogs/join-group-dialog.ts`

**Interfaces:**

- Consumes: `LanInviteSession` (Task 9).
- Produces: `<local-network-join>`, which emits `local-invite-received` with `detail: { code: string; groupName: string }`.

The element owns its session: it opens on `connectedCallback` and closes on `disconnectedCallback`, so leaving the dialog is what stops the broadcast. The default intent window is 10 minutes — long enough to find someone in the room, short enough to be over before you have forgotten about it.

Lit elements are not unit-tested here; `yarn typecheck:web` plus the manual run in Task 12 is the check.

- [ ] **Step 1: Write the element**

```typescript
// src/renderer/src/app/dialogs/local-network-join.ts
import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';

import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

import { LanInviteSession } from '../../lan-invite/lan-invite-session.js';
import { mossStyles } from '../../shared-styles.js';

const INTENT_WINDOW_MS = 10 * 60 * 1000;

@localized()
@customElement('local-network-join')
export class LocalNetworkJoin extends LitElement {
  private session = new LanInviteSession(window.electronAPI);

  _myName = new StoreSubscriber(
    this,
    () => this.session.myName,
    () => [],
  );

  _receivedInvite = new StoreSubscriber(
    this,
    () => this.session.receivedInvite,
    () => [],
  );

  @state()
  private starting = false;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.session.open();
  }

  async disconnectedCallback(): Promise<void> {
    super.disconnectedCallback();
    await this.session.close();
  }

  private async start(): Promise<void> {
    this.starting = true;
    try {
      await this.session.advertiseIntent(INTENT_WINDOW_MS);
    } finally {
      this.starting = false;
    }
  }

  private accept(invite: { code: string; groupName: string }): void {
    this.dispatchEvent(
      new CustomEvent('local-invite-received', {
        detail: invite,
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const invite = this._receivedInvite.value;
    if (invite) {
      return html`
        <div class="panel column">
          <span class="admitted"
            >${msg('You have been admitted to')} <strong>${invite.groupName}</strong></span
          >
          <button class="moss-button" @click=${() => this.accept(invite)}>
            ${msg('Join Group')}
          </button>
        </div>
      `;
    }

    const name = this._myName.value;
    if (name) {
      return html`
        <div class="panel column">
          <span>${msg('You are visible on this network as')}</span>
          <span class="name">${name}</span>
          <span class="hint"
            >${msg('Ask a steward or member of the group to admit you under that name.')}</span
          >
          <button class="moss-button secondary" @click=${() => this.session.stopIntent()}>
            ${msg('Stop')}
          </button>
        </div>
      `;
    }

    return html`
      <button class="moss-button secondary" .disabled=${this.starting} @click=${() => this.start()}>
        ${this.starting ? html`<sl-spinner></sl-spinner>` : msg('Ask to be let in')}
      </button>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: block;
      }
      .panel {
        align-items: center;
        gap: 8px;
        padding: 16px;
        border-radius: 12px;
        background: var(--moss-grey-light, rgba(0, 0, 0, 0.04));
      }
      .name {
        font-size: 22px;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .hint,
      .admitted {
        font-size: 14px;
        opacity: 0.8;
        text-align: center;
      }
    `,
  ];
}
```

- [ ] **Step 2: Put it in the join dialog**

In `src/renderer/src/app/dialogs/join-group-dialog.ts`, add the import beside the others:

```typescript
import './local-network-join.js';
```

and render it above the paste field, inside the `this._joinByPaste` branch, so it appears only when someone is joining by hand rather than following an invite link:

```typescript
                  <local-network-join
                    style="margin-bottom: 20px; width: 400px;"
                    @local-invite-received=${(e: CustomEvent<{ code: string; groupName: string }>) =>
                      this.joinGroup({ link: e.detail.code })}
                  ></local-network-join>
                  <sl-input
                    name="link"
                    id="invite-link-field"
```

`joinGroup` already parses whatever string it is given with `partialModifiersFromInviteString`, so a code that arrived over the network takes exactly the path a pasted one does.

- [ ] **Step 3: Check it compiles**

Run: `yarn typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/app/dialogs/local-network-join.ts src/renderer/src/app/dialogs/join-group-dialog.ts
git commit -m "feat(lan-invite): let a newcomer ask to be let in under a spoken name"
```

---

### Task 11: The member admits them

**Files:**

- Create: `src/renderer/src/groups/elements/invite/local-network-invite.ts`
- Modify: `src/renderer/src/groups/elements/invite/invite-people-dialog.ts`

**Interfaces:**

- Consumes: `LanInviteSession` (Task 9); `modifiersToInviteCode` from `src/renderer/src/invite-link.ts`.
- Produces: `<local-network-invite>` with properties `inviteCode: string` and `groupName: string`.

The element takes the already-derived invite code as a property rather than deriving it itself, so it stays independent of `DnaModifiers` and of the group store.

- [ ] **Step 1: Write the element**

```typescript
// src/renderer/src/groups/elements/invite/local-network-invite.ts
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { localized, msg } from '@lit/localize';
import { StoreSubscriber } from '@holochain-open-dev/stores';
import { notify } from '@holochain-open-dev/elements';

import '@shoelace-style/shoelace/dist/components/checkbox/checkbox.js';

import { LanInviteSession } from '../../../lan-invite/lan-invite-session.js';
import { mossStyles } from '../../../shared-styles.js';

@localized()
@customElement('local-network-invite')
export class LocalNetworkInvite extends LitElement {
  @property({ type: String })
  inviteCode!: string;

  @property({ type: String })
  groupName!: string;

  private session = new LanInviteSession(window.electronAPI);

  _intents = new StoreSubscriber(
    this,
    () => this.session.intents,
    () => [],
  );

  @state()
  private selected = new Set<string>();

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.session.open();
  }

  async disconnectedCallback(): Promise<void> {
    super.disconnectedCallback();
    await this.session.close();
  }

  private toggle(sid: string, checked: boolean): void {
    const next = new Set(this.selected);
    if (checked) next.add(sid);
    else next.delete(sid);
    this.selected = next;
  }

  private async admit(): Promise<void> {
    const sids = [...this.selected];
    await this.session.admit(sids, this.inviteCode, this.groupName);
    this.selected = new Set();
    notify(msg('Invite sent over the local network.'));
  }

  render() {
    const intents = this._intents.value ?? [];
    return html`
      <div class="column" style="gap: 8px;">
        <span style="opacity: 0.7; font-size: 16px;"
          >${msg('People on this network asking to join:')}</span
        >
        ${intents.length === 0
          ? html`<span class="empty">${msg('Nobody nearby is asking to join right now.')}</span>`
          : html`
              ${intents.map(
                (intent) => html`
                  <div class="row intent">
                    <sl-checkbox
                      .checked=${this.selected.has(intent.sid)}
                      .disabled=${intent.ambiguous}
                      @sl-change=${(e: CustomEvent) =>
                        this.toggle(intent.sid, (e.target as HTMLInputElement).checked)}
                    >
                      ${intent.name}
                    </sl-checkbox>
                    ${intent.ambiguous
                      ? html`<span class="ambiguous"
                          >${msg(
                            'Two people are showing this name — ask one of them to start again.',
                          )}</span
                        >`
                      : html``}
                  </div>
                `,
              )}
              <button
                class="moss-button"
                style="width: 180px;"
                .disabled=${this.selected.size === 0}
                @click=${() => this.admit()}
              >
                ${msg('Add to Group')}
              </button>
            `}
      </div>
    `;
  }

  static styles = [
    mossStyles,
    css`
      :host {
        display: block;
      }
      .intent {
        align-items: center;
        gap: 12px;
      }
      .empty,
      .ambiguous {
        font-size: 14px;
        opacity: 0.7;
      }
    `,
  ];
}
```

- [ ] **Step 2: Put it in the invite dialog**

In `src/renderer/src/groups/elements/invite/invite-people-dialog.ts`, add the import:

```typescript
import './local-network-invite.js';
```

and render it after the invite-code row, before the "About invites" block:

```typescript
            <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">
              ${msg('Local network')}
            </div>
            <local-network-invite
              style="margin-bottom: 40px;"
              .inviteCode=${invitationCode}
              .groupName=${this.groupProfile.name}
            ></local-network-invite>
```

Reduce the `margin-bottom: 60px` on the invite-code row above to `24px` so the dialog does not gain a gap.

- [ ] **Step 3: Check it compiles**

Run: `yarn typecheck:web`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/groups/elements/invite/local-network-invite.ts src/renderer/src/groups/elements/invite/invite-people-dialog.ts
git commit -m "feat(lan-invite): admit people from the Invite People pane"
```

---

### Task 12: Verify flow B between two running agents

**Files:** none — this is a manual gate before flow A is built on the same core.

- [ ] **Step 1: Run everything that can be run automatically**

Run: `yarn test:unit && yarn typecheck && yarn lint`
Expected: all green. Fix anything that is not before going on.

- [ ] **Step 2: Launch two agents**

Run: `yarn applet-dev-example`
This starts two Electron instances on one machine. Multicast loopback is on, so they see each other's beacons.

- [ ] **Step 3: Walk the flow**

1. In agent 2, open Join Group and press _Ask to be let in_. Note the three-word name.
2. In agent 1, open a group's Invite People pane. The same name should appear in the local network list within a few seconds.
3. Tick it and press _Add to Group_.
4. Agent 2 should show "You have been admitted to \<group\>"; press Join Group and confirm it lands in the group.

- [ ] **Step 4: Check that it is actually ephemeral**

1. In agent 2, press _Stop_, then confirm the entry disappears from agent 1's list within about ten seconds.
2. Close both dialogs, then reopen agent 1's Invite People pane: the list should be empty rather than showing stale entries.
3. Confirm no new files appeared under the profile directory (`~/.config/org.lightningrodlabs.moss-*/`).

- [ ] **Step 5: Record the result**

If anything fails, fix it and repeat before moving on — every later task builds on this core. Note anything surprising in the commit message of the fix.

---

### Task 13: Presence — group offers and flow A

**Files:**

- Modify: `src/renderer/src/lan-invite/presence.ts`
- Modify: `src/renderer/src/lan-invite/presence.test.ts`

**Interfaces:**

- Consumes: everything Task 8 produced.
- Produces, added to `Presence`:
  - `offerGroup(groupName: string, inviteCode: string, durationMs: number): Promise<void>`
  - `stopOffer(): void`
  - `requestInvite(sid: string): Promise<void>`
  - `heardOffers(): HeardOffer[]` where `HeardOffer = { sid: string; groupName: string; ambiguous: boolean; lastSeen: number }`

Flow A is offer → request → sealed. The advertiser answers any `invite-request` naming its session id, because a broadcast window means exactly that anyone on this network may join while it is open.

The joiner keeps the `offerKey` it heard and requires the sealed reply's `senderKey` to equal it. That is what stops a bystander who saw the unicast request racing a forged reply back.

- [ ] **Step 1: Add the failing tests**

Append to `src/renderer/src/lan-invite/presence.test.ts`:

```typescript
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
    const impostor = node();
    const newcomer = node();
    await member.presence.offerGroup('Team Standup', CODE, 60_000);
    await deliverBeacon(member, newcomer, '192.168.1.4');

    const [offer] = newcomer.presence.heardOffers();
    await newcomer.presence.requestInvite(offer.sid);

    // The impostor saw the request go past and answers it with its own key.
    await impostor.presence.receive(newcomer.unicasts[0].payload, '192.168.1.9', 47654);
    for (const sent of impostor.unicasts) {
      await newcomer.presence.receive(sent.payload, '192.168.1.7', 47654);
    }
    expect(newcomer.invites).toEqual([]);
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `yarn vitest run src/renderer/src/lan-invite/presence.test.ts`
Expected: FAIL — `offerGroup` is not a function.

- [ ] **Step 3: Extend the implementation**

Add to `presence.ts`:

```typescript
export type HeardOffer = { sid: string; groupName: string; ambiguous: boolean; lastSeen: number };

type OfferRecord = {
  sid: string;
  groupName: string;
  offerKey: Uint8Array;
  address: string;
  port: number;
  lastSeen: number;
};

type OfferSession = { sid: string; keys: SessionKeys; inviteCode: string; groupName: string };
type RequestSession = { sid: string; keys: SessionKeys; offerKey: Uint8Array };
```

Inside `createPresence`, add the state and extend `receive`:

```typescript
const offers = new Map<string, OfferRecord>();
let offerSession: OfferSession | undefined;
let requestSession: RequestSession | undefined;
```

In `prune()`, expire `offers` on the same cutoff as `heard`.

In `receive`, add two branches before the `invite-sealed` one:

```typescript
if (message.kind === 'group-offer') {
  const existing = offers.get(message.sid);
  if (existing) {
    existing.lastSeen = deps.now();
    existing.address = address;
    existing.port = port;
    return;
  }
  prune();
  if (offers.size >= MAX_HEARD) return;
  offers.set(message.sid, {
    sid: message.sid,
    groupName: message.groupName,
    offerKey: message.offerKey,
    address,
    port,
    lastSeen: deps.now(),
  });
  changed();
  return;
}

if (message.kind === 'invite-request') {
  // An open window means anyone on this network may join while it lasts,
  // so a request naming this session is answered without asking again.
  if (!offerSession || offerSession.sid !== message.sid) return;
  const sealed = await seal(
    formatInvite(offerSession.inviteCode, offerSession.groupName),
    message.requesterKey,
    offerSession.keys,
  );
  deps.unicast(
    encodeMessage({
      v: LAN_INVITE_PROTOCOL_VERSION,
      kind: 'invite-sealed',
      sid: message.sid,
      senderKey: offerSession.keys.publicKeyRaw,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
    }),
    address,
    port,
  );
  return;
}
```

Extend the `invite-sealed` branch to accept a reply to a request as well as to an intent, replacing its body with:

```typescript
if (message.kind === 'invite-sealed') {
  const session = sessionFor(message.sid, message.senderKey);
  if (!session) return;
  const plaintext = await open(
    { nonce: message.nonce, ciphertext: message.ciphertext },
    message.senderKey,
    session,
  );
  if (!plaintext) return;
  const invite = parseInvite(plaintext);
  if (!invite) return;
  deps.onInvite(invite);
  changed();
}
```

with this helper alongside `prune`:

```typescript
/**
 * Which of our own sessions, if any, this sealed reply answers. A reply to a
 * request must come from the key the offer advertised: that is what stops a
 * bystander who saw the request racing a forged reply back.
 */
function sessionFor(sid: string, senderKey: Uint8Array): SessionKeys | undefined {
  if (intentSession?.sid === sid) return intentSession.keys;
  if (requestSession?.sid === sid && sameBytes(requestSession.offerKey, senderKey)) {
    return requestSession.keys;
  }
  return undefined;
}
```

Add the four new methods to the returned object:

```typescript
    async offerGroup(groupName, inviteCode, durationMs) {
      const keys = await generateSessionKeys();
      const sid = randomSid();
      offerSession = { sid, keys, inviteCode, groupName };
      deps.advertise(
        encodeMessage({
          v: LAN_INVITE_PROTOCOL_VERSION,
          kind: 'group-offer',
          sid,
          groupName,
          offerKey: keys.publicKeyRaw,
        }),
        durationMs,
      );
      changed();
    },

    stopOffer() {
      offerSession = undefined;
      deps.stopAdvertising();
      changed();
    },

    async requestInvite(sid) {
      const offer = offers.get(sid);
      if (!offer) return;
      const keys = await generateSessionKeys();
      requestSession = { sid, keys, offerKey: offer.offerKey };
      deps.unicast(
        encodeMessage({
          v: LAN_INVITE_PROTOCOL_VERSION,
          kind: 'invite-request',
          sid,
          requesterKey: keys.publicKeyRaw,
        }),
        offer.address,
        offer.port,
      );
    },

    heardOffers() {
      prune();
      const ambiguous = duplicateNames([...offers.values()].map((o) => o.groupName));
      return [...offers.values()]
        .map((offer) => ({
          sid: offer.sid,
          groupName: offer.groupName,
          ambiguous: ambiguous.has(offer.groupName),
          lastSeen: offer.lastSeen,
        }))
        .sort((a, b) => a.groupName.localeCompare(b.groupName));
    },
```

and this comparison helper at the bottom of the file:

```typescript
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

Update the `Presence` type with the four new members and export `HeardOffer`.

- [ ] **Step 4: Run the whole suite and watch it pass**

Run: `yarn vitest run src/renderer/src/lan-invite/`
Expected: PASS — the 13 tests from Task 8 plus 7 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lan-invite/presence.ts src/renderer/src/lan-invite/presence.test.ts
git commit -m "feat(lan-invite): offer a group to the network and answer who asks"
```

---

### Task 14: Flow A in the session and the two panes

**Files:**

- Modify: `src/renderer/src/lan-invite/lan-invite-session.ts`
- Modify: `src/renderer/src/lan-invite/lan-invite-session.test.ts`
- Modify: `src/renderer/src/groups/elements/invite/local-network-invite.ts`
- Modify: `src/renderer/src/app/dialogs/local-network-join.ts`

**Interfaces:**

- Consumes: `offerGroup`, `stopOffer`, `requestInvite`, `heardOffers`, `HeardOffer` (Task 13).
- Produces, added to `LanInviteSession`: `offers: Writable<HeardOffer[]>`, `offering: Writable<{ until: number } | undefined>`, `offerGroup(groupName, inviteCode, durationMs): Promise<void>`, `stopOffer(): void`, `requestInvite(sid): Promise<void>`.

- [ ] **Step 1: Add the failing session test**

Append to `src/renderer/src/lan-invite/lan-invite-session.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `yarn vitest run src/renderer/src/lan-invite/lan-invite-session.test.ts`
Expected: FAIL — `offerGroup` is not a function.

- [ ] **Step 3: Extend the session**

Extend the existing presence import to bring in the offer type:

```typescript
import { createPresence, type HeardIntent, type HeardOffer, type Presence } from './presence.js';
```

then add the two stores beside the others:

```typescript
  readonly offers: Writable<HeardOffer[]> = writable([]);
  readonly offering: Writable<{ until: number } | undefined> = writable(undefined);
```

In the `onChange` callback passed to `createPresence`, also refresh the offers:

```typescript
      onChange: () => {
        this.intents.set(this.presence.heardIntents());
        this.offers.set(this.presence.heardOffers());
      },
```

Do the same in the expiry tick in `open()`, and clear `offers` and `offering` in `close()` alongside the other stores. Add the three methods:

```typescript
  async offerGroup(groupName: string, inviteCode: string, durationMs: number): Promise<void> {
    await this.presence.offerGroup(groupName, inviteCode, durationMs);
    this.offering.set({ until: Date.now() + durationMs });
  }

  stopOffer(): void {
    this.presence.stopOffer();
    this.offering.set(undefined);
  }

  async requestInvite(sid: string): Promise<void> {
    await this.presence.requestInvite(sid);
  }
```

In `close()`, call `this.presence.stopOffer()` next to `this.presence.stopIntent()`.

- [ ] **Step 4: Run it and watch it pass**

Run: `yarn vitest run src/renderer/src/lan-invite/lan-invite-session.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the broadcast control to the invite pane**

In `local-network-invite.ts`, add a duration select and a countdown above the intent list. Import the Shoelace select and option modules beside the checkbox import, add:

```typescript
  _offering = new StoreSubscriber(
    this,
    () => this.session.offering,
    () => [],
  );

  @state()
  private durationMinutes = 15;

  @state()
  private remaining = '';

  private countdown: ReturnType<typeof setInterval> | undefined;
```

start a 1-second countdown in `connectedCallback` and clear it in `disconnectedCallback`:

```typescript
this.countdown = setInterval(() => {
  const offering = this._offering.value;
  if (!offering) {
    this.remaining = '';
    return;
  }
  const left = Math.max(0, offering.until - Date.now());
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  this.remaining = `${minutes}:${String(seconds).padStart(2, '0')}`;
  if (left === 0) this.session.stopOffer();
}, 1000);
```

and render, above the intent list:

```typescript
      ${this._offering.value
        ? html`
            <div class="row broadcasting">
              <span
                >${msg('Broadcasting this group on the local network')} —
                <strong>${this.remaining}</strong></span
              >
              <button class="moss-button secondary" @click=${() => this.session.stopOffer()}>
                ${msg('Stop')}
              </button>
            </div>
          `
        : html`
            <div class="row" style="align-items: center; gap: 8px;">
              <sl-select
                class="moss-select"
                value=${String(this.durationMinutes)}
                @sl-change=${(e: CustomEvent) =>
                  (this.durationMinutes = Number((e.target as HTMLInputElement).value))}
              >
                <sl-option value="5">${msg('5 minutes')}</sl-option>
                <sl-option value="15">${msg('15 minutes')}</sl-option>
                <sl-option value="60">${msg('60 minutes')}</sl-option>
              </sl-select>
              <button
                class="moss-button"
                @click=${() =>
                  this.session.offerGroup(
                    this.groupName,
                    this.inviteCode,
                    this.durationMinutes * 60_000,
                  )}
              >
                ${msg('Broadcast joining link')}
              </button>
            </div>
            <span class="hint"
              >${msg('While this runs, anyone on this network can join the group.')}</span
            >
          `}
```

That one line is the only warning in either flow, and it stays: it describes what the member is switching on, not who else might be present.

- [ ] **Step 6: Add the group list to the join pane**

In `local-network-join.ts`, subscribe to the offers and render them above the _Ask to be let in_ button, only when something has been heard:

```typescript
_offers = new StoreSubscriber(
  this,
  () => this.session.offers,
  () => [],
);
```

```typescript
const offers = this._offers.value ?? [];
const groupList = offers.length
  ? html`
      <div class="column" style="gap: 6px; width: 100%; margin-bottom: 16px;">
        <span class="hint">${msg('Groups on this local network:')}</span>
        ${offers.map(
          (offer) => html`
            <div class="row offer">
              <span>${offer.groupName}</span>
              ${offer.ambiguous
                ? html`<span class="hint"
                    >${msg('Two groups are showing this name — ask which is which.')}</span
                  >`
                : html`<button
                    class="moss-button"
                    @click=${() => this.session.requestInvite(offer.sid)}
                  >
                    ${msg('Join')}
                  </button>`}
            </div>
          `,
        )}
      </div>
    `
  : html``;
```

Render `groupList` before the existing button in the no-name branch. The sealed reply arrives through the same `receivedInvite` store flow B already uses, so the "You have been admitted to" panel handles both flows without change.

- [ ] **Step 7: Check it compiles**

Run: `yarn typecheck:web && yarn lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/lan-invite/lan-invite-session.ts src/renderer/src/lan-invite/lan-invite-session.test.ts src/renderer/src/groups/elements/invite/local-network-invite.ts src/renderer/src/app/dialogs/local-network-join.ts
git commit -m "feat(lan-invite): broadcast a group for a window and join one from the list"
```

---

### Task 15: A diagnostic for when nothing is found

**Files:**

- Modify: `src/renderer/src/lan-invite/lan-invite-session.ts`
- Modify: `src/renderer/src/app/debugging-panel/debugging-panel.ts`

**Interfaces:**

- Consumes: `lanBeaconDiagnostics` (Task 7).
- Produces: `LanInviteSession.diagnostics(): Promise<BeaconDiagnostics>` and a read-only section in the existing debugging panel.

Every network failure in this feature looks identical from the UI — an empty list. The diagnostic is what makes a field report legible: whether the socket bound, which interfaces it joined, and how many datagrams arrived or were dropped.

- [ ] **Step 1: Expose it on the session**

Add to `LanBeaconApi`:

```typescript
lanBeaconDiagnostics: () =>
  Promise<{
    bound: boolean;
    interfaces: string[];
    advertising: boolean;
    received: number;
    dropped: number;
  }>;
```

and to `LanInviteSession`:

```typescript
  diagnostics(): ReturnType<LanBeaconApi['lanBeaconDiagnostics']> {
    return this.api.lanBeaconDiagnostics();
  }
```

Update the `fakeApi` helper in `lan-invite-session.test.ts` to include `lanBeaconDiagnostics: async () => ({ bound: true, interfaces: ['eth0'], advertising: false, received: 0, dropped: 0 })`, so the existing tests still compile.

- [ ] **Step 2: Show it in the debugging panel**

`debugging-panel.ts` already holds its per-section data in `@state()` fields and renders them inline; add one more in that style.

```typescript
  @state()
  private _lanBeacon: {
    bound: boolean;
    interfaces: string[];
    advertising: boolean;
    received: number;
    dropped: number;
  } | undefined;

  private _lanSession = new LanInviteSession(window.electronAPI);
  private _lanPoll: ReturnType<typeof setInterval> | undefined;
```

Open the session and start polling where the panel begins its other work, and tear both down in `disconnectedCallback`:

```typescript
await this._lanSession.open();
this._lanPoll = setInterval(async () => {
  this._lanBeacon = await this._lanSession.diagnostics();
}, 2000);
```

```typescript
if (this._lanPoll !== undefined) clearInterval(this._lanPoll);
void this._lanSession.close();
```

Render it as plain text — this pane is a developer surface, so match the surrounding sections and do not wrap these strings in `msg()`:

```typescript
const lan = this._lanBeacon;
const lanSection = lan
  ? html`<div>
      <div>LAN beacon socket bound: ${lan.bound}</div>
      <div>Interfaces joined: ${lan.interfaces.join(', ') || 'none'}</div>
      <div>Advertising: ${lan.advertising}</div>
      <div>Datagrams received: ${lan.received} — dropped: ${lan.dropped}</div>
    </div>`
  : html`<div>LAN beacon: not started</div>`;
```

An empty interface list with `bound: true` is the multi-homed failure; `bound: false` is a refused socket or a denied OS permission; `received: 0` on both machines with interfaces listed is a network that drops our traffic.

- [ ] **Step 3: Verify**

Run: `yarn test:unit && yarn typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lan-invite/lan-invite-session.ts src/renderer/src/lan-invite/lan-invite-session.test.ts src/renderer/src/app/debugging-panel/debugging-panel.ts
git commit -m "feat(lan-invite): report what the socket actually joined and heard"
```

---

### Task 16: Localization, the manual recipe, and the final gate

**Files:**

- Modify: `src/renderer/xliff/*.xlf` (nine locales)
- Modify: `src/renderer/src/locales/generated/*.ts` (generated — do not hand-edit)
- Create: `plans/lan-invite-two-machine-test.md`
- Modify: `plans/lan-invite-exchange.md` (status line)

- [ ] **Step 1: Extract the new strings**

Run: `cd src/renderer && npx lit-localize extract`
This adds a `<trans-unit>` per new `msg()` to each of the nine XLIFF files with an empty `<target>`.

- [ ] **Step 2: Translate them**

Fill in the `<target>` of every new unit in `de.xlf`, `fr.xlf`, `es.xlf`, `tr.xlf`, `it.xlf`, `pt.xlf`, `ja.xlf`, `nl.xlf`. Keep the three-word name and the group name as substituted values, never translated. Watch the length of "Ask to be let in" and "Broadcast joining link" — both sit on buttons of fixed width; if a translation does not fit, widen the button rather than truncating the words.

- [ ] **Step 3: Build the generated modules**

Run: `cd src/renderer && npx lit-localize build`

- [ ] **Step 4: Write the two-machine recipe**

Create `plans/lan-invite-two-machine-test.md` in the style of `plans/mdns-two-machine-test.md`, covering: a home LAN, a phone hotspot with the phone offline, and a machine with an active VPN. For each, both flows, and for each failure the reading from the debugging panel — bound or not, which interfaces, received and dropped counts. State explicitly that a phone with no cellular service may refuse to start a hotspot at all, which is a test-setup failure rather than a defect.

- [ ] **Step 5: Update the spec's status line**

Change the `Status:` line at the top of `plans/lan-invite-exchange.md` from `DESIGN (nothing started)` to a line naming the branch and the date it landed.

- [ ] **Step 6: Run everything**

Run: `yarn test:unit && yarn typecheck && yarn lint && yarn build`
Expected: all green. Report the actual output; do not summarise a run you did not do.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/xliff src/renderer/src/locales/generated plans/lan-invite-two-machine-test.md plans/lan-invite-exchange.md
git commit -m "chore(lan-invite): translate the new strings and record the field recipe"
```
