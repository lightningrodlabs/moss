# Versions and Upgrading

Each Moss line runs one Holochain version, and a Tool must be built for that Holochain version to load. Moss 0.16 runs on Holochain 0.7. A Tool built for Moss 0.15 (Holochain 0.6) does not load in Moss 0.16. The two Moss versions install side by side on the same computer, each with its own groups, so a Tool needs one build per Moss version while both are in use.

This page lists the versions a Tool for Moss 0.16 needs, the steps to move a Tool from 0.15, and what changed in the API.

## Versions

| Component                      | Version for Moss 0.16 |
| ------------------------------ | --------------------- |
| Holochain                      | 0.7.0                 |
| HDK / HDI                      | 0.7.0 / 0.8.0         |
| `@holochain/client`            | 0.21                  |
| `@theweave/api`                | 0.7.x                 |
| `@theweave/cli`                | 0.16.x                |
| `@holochain-open-dev/profiles` | 0.701                 |
| Weave link scheme              | `weave-0.16://`       |

The Holochain version is pinned in `moss.config.json` in the [Moss repository](https://github.com/lightningrodlabs/moss/blob/main-0.7/moss.config.json). The npm versions match the example Tool in [`example/ui/package.json`](https://github.com/lightningrodlabs/moss/blob/main-0.7/example/ui/package.json).

## Rebuild your Tool for Holochain 0.7

1. Set `hdk` to 0.7.0 and `hdi` to 0.8.0 in your zome crates, then follow the Holochain 0.6 to 0.7 upgrade guide on [developer.holochain.org](https://developer.holochain.org) for the zome API changes.
2. Set `@holochain/client` to 0.21, `@theweave/api` to 0.7 and `@theweave/cli` to 0.16 in your UI and root packages.
3. Use the `main-0.7` branch of holonix for the Holochain toolchain, as shown in [Holochain Development Environment](./holochain-development-environment).
4. Rebuild the `.happ` and `.webhapp` files.
5. Publish the rebuilt Tool under a new version branch, as described below.

## Publish under a new version branch

Moss groups a Tool's versions by the `versionBranch` field of its Tool list entry, and treats every version in one branch as compatible. The stable Lightningrod Labs list enforces this: all versions in a branch must share the same `happSha256`. A rebuild for Holochain 0.7 changes the happ hash, so it needs a new `versionBranch` in a new Tool list entry.

Tool lists and curation lists are published per Moss version line. The 0.16 lists live in the `0.16/` folder of the [weave-tool-curation](https://github.com/lightningrodlabs/weave-tool-curation) repository, and Moss 0.16 reads the curation list at:

```
https://lightningrodlabs.org/weave-tool-curation/0.16/curations-0.16.json
```

The 0.16 folder also has a separate dev list for in-development builds. The folder's README explains both, together with the required shape of a Tool's `description` and `changelog` fields. See [Publishing a Tool](./publishing-a-tool) for the list formats.

## `@theweave/api` 0.7

### Removed: block views

Block views were advertised by earlier versions of the API but never worked in Moss. They are gone from the API:

- `WeaveClient.openAppletBlock` and `WeaveClient.openCrossGroupBlock`
- `AppletServices.blockTypes`, with the `BlockType` and `BlockName` types
- The `block` arm of `AppletView`. `CrossGroupView` is now only `{ type: 'main' }`.

If your Tool declared `blockTypes` in its `AppletServices`, delete the field.

### `openCrossGroupMain(toolCompatibilityId)`

`WeaveClient.openCrossGroupMain` now works. It switches the Moss dashboard to the cross-group view of a Tool class. Its argument is the Tool's compatibility id, which Moss derives from the Tool list URL, the Tool id and the `versionBranch`. A Tool offers a cross-group view by setting `"crossGroupView": true` in the `weave.config.json` at the root of its UI.

### `renderInfo.renderLocation`

Applet views receive `renderLocation`, which tells the Tool where Moss shows the view:

| Value        | Meaning                                            |
| ------------ | -------------------------------------------------- |
| `'main'`     | The Tool's main view                               |
| `'embedded'` | An asset embedded inline, such as a dashboard tile |
| `'side'`     | The side-panel asset viewer                        |
| `'window'`   | A standalone window                                |

Use it to keep embedded views light. For example, a video call Tool must not join a room when it is only shown as a dashboard tile. The field is undefined on hosts older than 0.16, so treat a missing value as `'main'`.

### Optional host features

Two features are present only when the host offers them. Detect them on the client instead of assuming them:

- `weaveClient.captureAudioSources` asks Moss for audio that plays on the user's computer. Moss shows its own source picker and returns a `MediaStreamTrack`, or `null` when the user declines. The method is absent when the Audio Sources service is off in Moss settings or capture does not work on the machine. See [`captureAudioSources`](/api-reference/api/api.weaveclient.captureaudiosources) in the API reference.
- `weaveClient.localModels` gives access to on-device speech recognition. See [Adding Audio Transcription to a Moss Tool](./transcription).

### Weave links and invite codes

Links now use the `weave-0.16://` scheme. Do not build link strings by hand. `weaveUrlFromWal(wal)` from `@theweave/api` produces a link with the scheme of the running host. Moss 0.16 also accepts invite codes, a paste-only form of an invite that survives channels which mangle unknown link schemes. Tools do not create invites, so no change is needed in a Tool.

## Installing Tools without the Tool library

Moss 0.16 can install a Tool when the curation list is unreachable. It first looks for the Tool's happ, UI and icon already on the computer, then asks group members who have the Tool to send it. Both paths verify the files against the hashes stored in the group's Applet entry, which come from the Tool list. For publishers this means that the hashes in a Tool list entry must be computed with `weave hash-webhapp`, as the curation repository README explains.

## Weave CLI 0.16

The CLI flags are listed in [Configure CLI](./configure-cli#_4-cli-options). In 0.16 the production bootstrap and relay default to `bootstrap-relay.moss.social`, and `--tool-curation-url <url>` overrides the curation list for a run.
