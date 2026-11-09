import { applyD1Migrations, env } from 'cloudflare:test';

// Each test file gets isolated storage, so the schema is applied before every file.
await applyD1Migrations(env.FEEDBACK_DB, env.TEST_MIGRATIONS);
