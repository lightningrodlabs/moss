# User-guide screenshot captures

These specs are **not regression tests**. They drive the built Moss app through
the flows documented in the [moss-user-docs](../../../../moss-user-docs) repo
and write PNGs straight into that repo's `docs/public/screenshots/` directory.

## Running

From the repo root, inside the project's nix shell:

```bash
# builds the app, then runs the screenshots project
yarn capture:screenshots
```

Or, if the app is already built:

```bash
yarn workspace tests capture:screenshots
```

Output goes to `../moss-user-docs/docs/public/screenshots/` by default.
Override with `MOSS_DOCS_SCREENSHOT_DIR=/abs/path`.

## What gets captured

| PNG | Guide page |
|-----|-----------|
| `home-screen.png` | install/first-launch |
| `add-group-dialog.png`, `create-group-dialog.png`, `group-created.png` | groups-and-tools/creating-a-group |
| `invite-people-dialog.png`, `join-group-dialog.png` | groups-and-tools/inviting-members |
| `tool-library.png`, `tool-details-dialog.png`, `tool-installed-in-group.png` | groups-and-tools/adding-tools |
| `settings.png`, `settings-language.png` | settings reference |

## Caveats

- e2e launches use **unpackaged builds**, which run in dev mode and skip the
  production `InitialSetup` / first-run screens. The genuine first-launch setup
  screen must still be captured by hand against a packaged build.
- Selectors track `main-0.6`. If a capture fails, the UI moved — fix the
  selector in the spec or the shared helper, same as for the smoke suite.
