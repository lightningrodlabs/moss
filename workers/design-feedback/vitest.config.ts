import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// A throwaway key so GitHub App JWT signing can run in tests without a real secret.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const testPrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
// The same key in the PKCS#1 form GitHub hands out for app private keys.
const testPrivateKeyPkcs1Pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const testPublicKeySpkiPem = createPublicKey(privateKey)
  .export({ type: 'spki', format: 'pem' })
  .toString();

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['FEEDBACK_DB'],
          kvNamespaces: ['FEEDBACK_KV'],
          r2Buckets: ['FEEDBACK_BUCKET'],
          bindings: {
            GITHUB_REPO_OWNER: 'o',
            GITHUB_REPO_NAME: 'r',
            R2_PUBLIC_URL: 'https://r2.test',
            GITHUB_APP_ID: '1',
            GITHUB_INSTALLATION_ID: '2',
            GITHUB_APP_PRIVATE_KEY: testPrivateKeyPem,
            GITHUB_APP_PRIVATE_KEY_PKCS1: testPrivateKeyPkcs1Pem,
            GITHUB_APP_PUBLIC_KEY_SPKI: testPublicKeySpkiPem,
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
    },
  };
});
