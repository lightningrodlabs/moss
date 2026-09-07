# Offering Tools that are already on this computer

Status: design 2026-09-04, implementation in progress on `feat/peer-tool-transfer`
(based on `main-0.7`).

## Problem

Create a group with the tool library unreachable and the library view says "No
Tools available yet", even when the machine holds every byte of several Tools
from other groups. The install path can already fall back to those local assets
(see `plans/peer-tool-transfer.md`), but nothing ever offers them, so the user
cannot reach that path from a new group.

## Goal

The library view lists the union of what the curation lists offer and what this
computer already has, with the locally-sourced ones marked and filterable. No
new stored data.

## Why no new persistence is needed

Everything a library entry needs is already on disk for an installed Tool:

- `apps/<appId>/info.json` (`AppAssetsInfo`) holds the happ, UI and webhapp
  sha256s and the `DistributionInfo`.
- `DistributionInfo` for a `web2-tool-list` Tool carries `toolName`,
  `toolListUrl`, `developerCollectiveId`, `toolId`, `versionBranch`,
  `toolVersion` and `toolCompatibilityId`.
- `tools/<toolCompatibilityId>/icon` holds the icon as a data URL.

Only `subtitle` and `description` are unavailable, and both are cosmetic.

## Design

### Enumeration (main, `localTools.ts`)

`listLocalTools(dirs)` walks `apps/*/info.json` and keeps an entry when all of
these hold: the assets info is a `webhapp` with a filesystem UI, its
distribution is `web2-tool-list`, and the happ, unpacked UI and icon are all
present on disk (the same three-file test the install path uses, reusing
`toolAssetsPresent`). Entries are deduplicated by `toolCompatibilityId`, keeping
the most recently installed, and `installedAt` comes from the happ file's mtime
so the library's "newest first" sort has something real to order by.

A malformed or half-written `info.json` is skipped rather than failing the
whole scan: this list is an offer, and one bad app directory must not hide
every other Tool.

### Merging (renderer, `local-tools.ts`)

`toolAndCurationInfoFromLocal` turns one `LocalToolInfo` into the same
`ToolAndCurationInfo` shape the curation lists produce: a single version branch
holding a single version whose hashes are the ones on disk, an empty `url`
(there is nothing to download), no curation infos, no tags, and the title taken
from `distributionInfo.info.toolName`.

`mergeLocalTools(libraryTools, localTools)` adds such an entry only when the
library has no tool with that `toolCompatibilityId`, so a Tool the library
offers is always described by the library. Added entries carry
`availableLocally: true`, which `groupToolsByBaseId` propagates to the unified
entry when every one of its branches is local.

The merge happens inside `fetchUnifiedTools`, so both the library view and the
tool info dialog see the same union.

### UX

- The card for a local-only Tool shows a badge reading "On this computer" with
  a tooltip: "Offered because it is installed on this computer. It is not in
  any curation list you can reach right now."
- The library's classification filter gains an "On this computer" option
  alongside "All", so the set can be isolated or ignored.
- The details dialog header dereferences the developer collective and the first
  curator unconditionally today, which a local-only entry does not have; both
  become optional.

### Installing one

No change. The synthesized version carries the hashes the assets on disk
actually have, so `installAndAdvertiseApplet` writes a correct Applet entry, and
`installApplet` fails at the library step (unreachable, or the Tool is not
listed) and falls through to the local assets it already knows how to use.

## Non-goals

- Recovering `subtitle` and `description` for a local-only Tool.
- Offering a Tool whose assets are only on a *peer's* computer. The group's
  Applet entries already cover that case; this is about starting a new group.
- Any change to how a Tool present in a reachable curation list is described.

## Testing

Unit: the enumeration against a temp profile directory (skips a Tool with a
missing icon, dedupes by compatibility id, ignores malformed entries), and the
pure merge and synthesis (library entry wins, local-only marked, hashes and
title carried through).

Manual: with the network off, create a group and confirm previously installed
Tools are offered, badged, filterable, and install without a download.
