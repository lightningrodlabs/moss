import {
  buildSignedHeaders,
  type SignedHeaders,
} from '../../../shared/utils/src/feedback/index.ts';

export interface TestReporter {
  pubKey: Uint8Array;
  /** Signs a request as this reporter; `nonce` overrides the random 16-byte nonce. */
  sign(p: {
    method: string;
    path: string;
    body: Uint8Array;
    nowSeconds: number;
    nonce?: Uint8Array;
  }): Promise<SignedHeaders>;
}

export async function makeTestReporter(): Promise<TestReporter> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const pubKey = new Uint8Array((await crypto.subtle.exportKey('raw', keyPair.publicKey)) as ArrayBuffer);
  return {
    pubKey,
    sign: (p) =>
      buildSignedHeaders({
        method: p.method,
        path: p.path,
        body: p.body,
        pubKey,
        nonce: p.nonce ?? crypto.getRandomValues(new Uint8Array(16)),
        nowSeconds: p.nowSeconds,
        sign: async (message) =>
          new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, message)),
      }),
  };
}
