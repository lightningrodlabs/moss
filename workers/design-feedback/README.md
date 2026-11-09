# Moss design feedback worker

This Cloudflare Worker receives signed feedback from Moss and creates GitHub issues from it.
It runs as a GitHub App, so no personal access token is needed.

The worker has two environments. The production environment files issues on `lightningrodlabs/moss`. The staging environment files issues on `lightningrodlabs/moss-feedback-staging`.

Run every `npm` command in this document from the `workers/design-feedback` directory. Run `npm ci` there once before you start.

## Before you start

Run `npx wrangler login` once. Wrangler is the Cloudflare command line tool. Every command below that talks to Cloudflare fails until you log in.

## 1. Create the GitHub App

1. Open the `lightningrodlabs` organization settings on github.com.
2. Open Developer settings, then GitHub Apps, then New GitHub App.
3. Enter a name and a homepage URL of your choice.
4. Under Repository permissions, set Issues to Read and write.
5. Set Metadata to Read-only.
6. Turn off Webhook. The worker does not use webhooks yet.
7. Select Enable Device Flow. A later phase needs it. Device Flow lets a user sign in to GitHub from Moss.
8. Under Where can this GitHub App be installed, select Only on this account.
9. Select Create GitHub App.
10. Write down the App ID shown at the top of the app page.
11. Select Generate a private key. GitHub downloads a `.pem` file. Keep this file secret.

The key file is in PKCS#1 format. The worker converts it to the format it needs, so you do not have to convert it.

## 2. Install the App on the two repositories

1. Open the app page and select Install App.
2. Select the `lightningrodlabs` organization.
3. Select Only select repositories.
4. Select `lightningrodlabs/moss` and `lightningrodlabs/moss-feedback-staging`.
5. Select Install.
6. Look at the URL of the installation settings page. The number at the end of the URL is the installation id. Write it down.

One installation covers both repositories. This means both environments use the same app id and the same installation id.

## 3. Create the Cloudflare resources

The worker uses three Cloudflare services. D1 is a SQL database. KV is a key-value store. R2 is object storage for the screenshots.

Create the production resources:

```
npx wrangler d1 create moss-feedback
npx wrangler kv namespace create FEEDBACK_KV
npx wrangler r2 bucket create moss-feedback-images
```

Create the staging resources:

```
npx wrangler d1 create moss-feedback-staging
npx wrangler kv namespace create FEEDBACK_KV --env staging
npx wrangler r2 bucket create moss-feedback-images-staging
```

Each `d1 create` and `kv namespace create` command prints an id. The R2 bucket has no id. Enable public access for each R2 bucket in the Cloudflare dashboard. The dashboard then shows the public URL of the bucket.

Open `wrangler.toml` and replace each placeholder with the matching value:

| Placeholder                                 | Value                                            |
| ------------------------------------------- | ------------------------------------------------ |
| `REPLACE_ME_GITHUB_APP_ID` (two places)     | The App ID from step 1                           |
| `REPLACE_ME_GITHUB_INSTALLATION_ID`         | The installation id from step 2                  |
| `REPLACE_ME_GITHUB_INSTALLATION_ID_STAGING` | The installation id from step 2                  |
| `REPLACE_ME_D1_PROD`                        | The id printed for `moss-feedback`               |
| `REPLACE_ME_D1_STAGING`                     | The id printed for `moss-feedback-staging`       |
| `REPLACE_ME_KV_PROD`                        | The production KV namespace id                   |
| `REPLACE_ME_KV_STAGING`                     | The staging KV namespace id                      |
| `REPLACE_ME_R2_PUBLIC_URL_STAGING`          | The public URL of `moss-feedback-images-staging` |

Check that `R2_PUBLIC_URL` in the production `[vars]` block is the public URL of `moss-feedback-images`.

## 4. Apply the database migrations

A migration creates the tables the worker needs. Apply them to the remote databases:

```
npm run migrate
npm run migrate:staging
```

## 5. Set the private key secret

A secret is a value that Wrangler stores encrypted and never shows again. Set the private key for each environment. Each command asks you to paste the value. Paste the full contents of the `.pem` file, including the BEGIN and END lines.

```
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
npx wrangler secret put GITHUB_APP_PRIVATE_KEY --env staging
```

## 6. Deploy

```
npm run deploy
npm run deploy:staging
```

Each command prints the URL of the deployed worker. Use the staging URL in the next section.

## 7. Point a development Moss at staging

Set the `MOSS_FEEDBACK_WORKER_URL` environment variable to the staging worker URL before you start Moss. For example:

```
MOSS_FEEDBACK_WORKER_URL=<staging worker URL> yarn tool-dev-example
```

Run this command from the root of the Moss repository. Moss then sends feedback to staging and files issues on `lightningrodlabs/moss-feedback-staging`.

Then follow `plans/feedback-phase1-manual-checklist.md`.

## 8. Revoke the old personal access token

If the old personal access token still exists, revoke it now. Open github.com, then Settings, then Developer settings, then Personal access tokens. Delete the token that the previous worker used. Do this after the new worker is deployed and working.
