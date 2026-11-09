import type { D1Migration } from 'cloudflare:test';
import type { Env as WorkerEnv } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
      GITHUB_APP_PRIVATE_KEY_PKCS1: string;
      GITHUB_APP_PUBLIC_KEY_SPKI: string;
    }
  }
}
