# Moss Release Instructions

## Release

1. Before running the release in CI it is worth checking that Moss is building fine locally. Run the corresponding command for your platform that you can read from the `package.json`. For linux:

```
yarn build:linux
```

2. If Moss builds fine locally, set the version number in `package.json` to the number you want to release Moss under. Then create a draft release on github with a tag `v[version number]`, e.g. `v0.14.5`:

![alt text](./img/draft-release.png)

Then click **"Save Draft"** to save the release as a draft. The CI workflow will expect a _draft_ release with the correct tag to upload the assets.

3. Now check out the `release` branch locally, merge `main` into `release` and run `git push`. This should start the release workflow on github.

4. Once the release workflow has succeeded, verify that all the expected assets have been added to the draft release and download one that's compatible with your operating system in order to do a manual test run. If it works to your satisfaction, you can publish the release, as pre-release or "latest", depending on what's appropriate.

## Update to a new version of Holochain

1. Go to https://github.com/holochain/holochain/releases and select the holochain release you want to use.
 
2. Update the holochain version in `moss.config.json`

3. Run `yarn update-hc-checksums` locally to automatically update the checksums in `holochain-checksums.json`.

4. Run `yarn fetch:binaries` locally to fetch the new binaries.

5. Follow the release process from the [Release](#release) section above.


## Update to a new version of group happ

Trigger `publish-happ` workflow. It will create the release draft automatically and use the version number from `package.json`.
Get the sha256 hash of the happ bundle and paste it into the `moss.config.json` file.


## Releasing NPM packages

For the CLI, make sure the updated holochain binaries have been fetched (`yarn build:cli ; cd cli & npm run postinstall`)

When updating all packages, publish in this order:

1. @theweave/api
1. @theweave/tool-library-client
1. @theweave/group-client 
1. @theweave/elements
1. @theweave/moss-types
1. @theweave/utils
2. @theweave/cli
3. @theweave/wdocker