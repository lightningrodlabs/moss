/** Bindings, vars and secrets the feedback worker runs with (see wrangler.toml). */
export interface Env {
  FEEDBACK_DB: D1Database;
  FEEDBACK_KV: KVNamespace;
  FEEDBACK_BUCKET: R2Bucket;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
  R2_PUBLIC_URL: string;
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}
