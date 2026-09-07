import fs from 'node:fs';
import path from 'node:path';
import { AppAssetsInfo, LocalToolInfo } from '@theweave/moss-types';
import { toolCompatibilityIdFromDistInfo } from '@theweave/utils';
import { toolAssetsPresent, ToolAssetDirs } from './peerToolAssets';

/**
 * The Tools this computer can install without downloading anything.
 *
 * Everything a library listing needs is already recorded for an installed
 * Tool -- the asset hashes and distribution info in the app's `info.json`, the
 * icon in its tool directory -- so a Tool obtained once can be offered again
 * for a new group even with no curation list in reach.
 */

export type LocalToolDirs = ToolAssetDirs & { appsDir: string };

function iconFor(dirs: LocalToolDirs, toolCompatibilityId: string): string | undefined {
  const iconPath = path.join(dirs.toolsDir, toolCompatibilityId, 'icon');
  try {
    return fs.readFileSync(iconPath, 'utf-8');
  } catch {
    return undefined;
  }
}

function localToolFrom(dirs: LocalToolDirs, appDir: string): LocalToolInfo | undefined {
  const infoPath = path.join(dirs.appsDir, appDir, 'info.json');
  if (!fs.existsSync(infoPath)) return undefined;
  const assetsInfo: AppAssetsInfo = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
  if (assetsInfo.type !== 'webhapp') return undefined;
  if (assetsInfo.ui.location.type !== 'filesystem') return undefined;
  if (assetsInfo.distributionInfo.type !== 'web2-tool-list') return undefined;

  const toolCompatibilityId = toolCompatibilityIdFromDistInfo(assetsInfo.distributionInfo);
  const happSha256 = assetsInfo.happ.sha256;
  const uiSha256 = assetsInfo.ui.location.sha256;
  // The same three files the offline install path needs; a Tool missing any of
  // them cannot actually be installed, so it must not be offered.
  if (!toolAssetsPresent(dirs, { happSha256, uiSha256, toolCompatibilityId })) return undefined;

  const icon = iconFor(dirs, toolCompatibilityId);
  if (!icon) return undefined;

  return {
    toolCompatibilityId,
    distributionInfo: assetsInfo.distributionInfo,
    happSha256,
    uiSha256,
    webhappSha256: assetsInfo.sha256,
    icon,
    installedAt: fs.statSync(path.join(dirs.happsDir, `${happSha256}.happ`)).mtimeMs,
  };
}

/**
 * One entry per Tool, newest install winning when the same Tool was installed
 * for several groups. A malformed or half-written app directory is skipped
 * rather than failing the scan: this list is an offer, and one bad entry must
 * not hide every other Tool.
 */
export function listLocalTools(dirs: LocalToolDirs): LocalToolInfo[] {
  let appDirs: string[];
  try {
    appDirs = fs
      .readdirSync(dirs.appsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const byToolId = new Map<string, LocalToolInfo>();
  for (const appDir of appDirs) {
    let tool: LocalToolInfo | undefined;
    try {
      tool = localToolFrom(dirs, appDir);
    } catch (e) {
      console.warn(`[local-tools] skipping ${appDir}: ${e}`);
      continue;
    }
    if (!tool) continue;
    const existing = byToolId.get(tool.toolCompatibilityId);
    if (!existing || existing.installedAt < tool.installedAt) {
      byToolId.set(tool.toolCompatibilityId, tool);
    }
  }
  return [...byToolId.values()].sort((a, b) => b.installedAt - a.installedAt);
}
