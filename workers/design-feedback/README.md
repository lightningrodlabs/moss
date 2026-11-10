# Moss design feedback worker

This Cloudflare Worker receives signed feedback from Moss and creates GitHub issues from it.
It runs as a GitHub App, so no personal access token is needed.

The worker has two environments. The production environment files issues on `lightningrodlabs/moss`. The staging environment files issues on `lightningrodlabs/moss-feedback-staging`.

Run every `npm` command in this document from the `workers/design-feedback` directory. Run `npm ci` there once before you start.

## Before you start

Run `npx wrangler login` once. Wrangler is the Cloudflare command line tool. Every command below that talks to Cloudflare fails until you log in.

## Platform requirements

Production needs the Workers Paid plan. Each Moss user syncs every 10 minutes, and each sync writes at least two KV keys for that user. A large sync also runs many D1 queries. With many users these exceed the daily KV write and D1 limits of the Workers Free plan.

## 1. Create the GitHub App

1. Open the `lightningrodlabs` organization settings on github.com.
2. Open Developer settings, then GitHub Apps, then New GitHub App.
3. Enter a name and a homepage URL of your choice.
4. Under Repository permissions, set Issues to Read and write.
5. Set Metadata to Read-only.
6. Turn off Webhook. The worker receives webhooks from the two repositories instead, as section 7 describes.
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

A migration creates the tables the worker needs. These scripts pass the `--remote` flag, so they apply the migrations to the databases in your Cloudflare account and not to a local copy:

```
npm run migrate
npm run migrate:staging
```

These commands apply every migration that is not applied yet, including `0002_comments.sql`, which phase 2 adds. If you set up the worker before phase 2, run them again before you deploy.

## 5. Set the private key secret

A secret is a value that Wrangler stores encrypted and never shows again. Set the private key for each environment. Each command reads the key from the `.pem` file you downloaded in step 1. Run the commands in the folder that contains the file, or give the full path to the file. Replace `app.pem` with the name of your file.

```
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < app.pem
npx wrangler secret put GITHUB_APP_PRIVATE_KEY --env staging < app.pem
```

## 6. Deploy

```
npm run deploy
npm run deploy:staging
```

Each command prints the URL of the deployed worker. Use the staging URL in the next section.

## 7. Add the repository webhooks

A webhook is a setting that makes GitHub send an HTTP request to a URL each time something happens in a repository. The worker uses webhooks to learn about new comments and closed issues.

Add the webhook to each repository and not to the App. One App installation covers both repositories, so a webhook on the App cannot tell the two environments apart. The App webhook stays off. The worker accepts only deliveries from its own repository.

Do these steps once for `lightningrodlabs/moss` and once for `lightningrodlabs/moss-feedback-staging`. Set the secret on the worker before you add the webhook. GitHub sends a `ping` event as soon as you add the webhook, and the worker can check that delivery only when it already has the secret.

1. Generate a secret in a terminal with `openssl rand -hex 32`. Use a different secret for each repository. Keep a copy for step 7.
2. Give the worker of that environment the secret. The command asks for the value on standard input:

   ```
   npx wrangler secret put WEBHOOK_SECRET
   npx wrangler secret put WEBHOOK_SECRET --env staging
   ```

   Run the first command for `lightningrodlabs/moss` and the second for `lightningrodlabs/moss-feedback-staging`. You can also pipe the value in. Replace `$SECRET` with the secret for that environment:

   ```
   printf '%s' "$SECRET" | npx wrangler secret put WEBHOOK_SECRET
   ```

3. Open the repository on github.com.
4. Select Settings, then Webhooks, then Add webhook.
5. Set Payload URL to the worker URL followed by `/v1/webhook`. Use the production worker URL for `lightningrodlabs/moss`. Use the staging worker URL for `lightningrodlabs/moss-feedback-staging`.
6. Set Content type to `application/json`.
7. Paste the secret from step 1 into the Secret field.
8. Under Which events would you like to trigger this webhook, select Let me select individual events.
9. Tick Issues and Issue comments. Untick Pushes. Leave every other event unticked.
10. Make sure Active is ticked.
11. Select Add webhook.

To confirm the setup, open the webhook on GitHub and select Recent Deliveries. The worker answers the `ping` with status 204, and GitHub shows a green check next to the delivery. If the delivery shows a red mark, check that the secret and the Payload URL match the environment.

If you added the webhook before you set the secret, the first `ping` shows a red mark. Set the secret, then open the `ping` in Recent Deliveries and select Redeliver. Expect a green check.

## 8. Point a development Moss at staging

Set the `MOSS_FEEDBACK_WORKER_URL` environment variable to the staging worker URL before you start Moss. For example:

```
MOSS_FEEDBACK_WORKER_URL=<staging worker URL> yarn tool-dev-example
```

Run this command from the root of the Moss repository. Moss then sends feedback to staging and files issues on `lightningrodlabs/moss-feedback-staging`.

Then follow `plans/feedback-manual-checklist.md`.

## 9. Revoke the old personal access token

If the old personal access token still exists, revoke it now. Open github.com, then Settings, then Developer settings, then Personal access tokens. Delete the token that the previous worker used. Do this after the new worker is deployed and working.
