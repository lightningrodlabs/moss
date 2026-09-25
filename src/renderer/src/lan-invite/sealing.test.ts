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
