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
    { name: 'AES-GCM', iv: new Uint8Array(nonce) },
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
      { name: 'AES-GCM', iv: new Uint8Array(sealed.nonce) },
      key,
      new Uint8Array(sealed.ciphertext),
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
    new Uint8Array(peerPublicKeyRaw),
    { name: 'ECDH', namedCurve: CURVE },
    false,
    [],
  );
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerKey },
    own.privateKey,
    256,
  );
  const material = await crypto.subtle.importKey('raw', new Uint8Array(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  const salt = new Uint8Array(saltFirst.length + saltSecond.length);
  salt.set(saltFirst, 0);
  salt.set(saltSecond, saltFirst.length);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(salt),
      info: new Uint8Array(
        new TextEncoder().encode(`moss-lan-invite/${LAN_INVITE_PROTOCOL_VERSION}/invite-sealed`),
      ),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
