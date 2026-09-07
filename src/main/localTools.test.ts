import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppAssetsInfo, DistributionInfo } from '@theweave/moss-types';
import { toolCompatibilityIdFromDistInfo } from '@theweave/utils';
import { listLocalTools, LocalToolDirs } from './localTools';

let root: string;
let dirs: LocalToolDirs;

function distInfo(toolId: string, versionBranch = '1', toolVersion = '1.2.3'): DistributionInfo {
  return {
    type: 'web2-tool-list',
    info: {
      toolListUrl: 'https://collective.example/tools.json',
      developerCollectiveId: 'collective',
      toolId,
      toolName: `${toolId} Tool`,
      versionBranch,
      toolVersion,
      toolCompatibilityId: 'ignored-derived-instead',
    },
  } as DistributionInfo;
}

/** Installs a Tool the way a real install leaves it on disk. */
function placeTool(options: {
  appId: string;
  distributionInfo: DistributionInfo;
  happSha256: string;
  uiSha256: string;
  withIcon?: boolean;
  withUi?: boolean;
  withHapp?: boolean;
}) {
  const {
    appId,
    distributionInfo,
    happSha256,
    uiSha256,
    withIcon = true,
    withUi = true,
    withHapp = true,
  } = options;
  const assetsInfo: AppAssetsInfo = {
    type: 'webhapp',
    sha256: `web${happSha256}`.slice(0, 64),
    assetSource: { type: 'https', url: 'https://collective.example/tool.webhapp' },
    distributionInfo,
    happ: { sha256: happSha256 },
    ui: { location: { type: 'filesystem', sha256: uiSha256 } },
  };
  const appDir = path.join(dirs.appsDir, appId);
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'info.json'), JSON.stringify(assetsInfo));
  if (withHapp) fs.writeFileSync(path.join(dirs.happsDir, `${happSha256}.happ`), 'happ-bytes');
  if (withUi) fs.mkdirSync(path.join(dirs.uisDir, uiSha256, 'assets'), { recursive: true });
  if (withIcon) {
    const toolDir = path.join(dirs.toolsDir, toolCompatibilityIdFromDistInfo(distributionInfo));
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(path.join(toolDir, 'icon'), 'data:image/png;base64,ICON');
  }
}

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-tools-'));
  dirs = {
    appsDir: path.join(root, 'apps'),
    happsDir: path.join(root, 'happs'),
    uisDir: path.join(root, 'uis'),
    toolsDir: path.join(root, 'tools'),
  };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('listLocalTools', () => {
  it('offers an installed Tool with everything it needs to install again', () => {
    const info = distInfo('presence');
    placeTool({ appId: 'applet#1', distributionInfo: info, happSha256: A, uiSha256: B });
    const tools = listLocalTools(dirs);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      toolCompatibilityId: toolCompatibilityIdFromDistInfo(info),
      happSha256: A,
      uiSha256: B,
      icon: 'data:image/png;base64,ICON',
    });
    expect(tools[0].distributionInfo).toEqual(info);
    expect(tools[0].installedAt).toBeGreaterThan(0);
  });

  it('skips a Tool whose happ, UI or icon is missing', () => {
    placeTool({
      appId: 'applet#noicon',
      distributionInfo: distInfo('noicon'),
      happSha256: A,
      uiSha256: B,
      withIcon: false,
    });
    placeTool({
      appId: 'applet#noui',
      distributionInfo: distInfo('noui'),
      happSha256: C,
      uiSha256: D,
      withUi: false,
    });
    placeTool({
      appId: 'applet#nohapp',
      distributionInfo: distInfo('nohapp'),
      happSha256: 'e'.repeat(64),
      uiSha256: 'f'.repeat(64),
      withHapp: false,
    });
    expect(listLocalTools(dirs)).toEqual([]);
  });

  it('keeps one entry per Tool, preferring the most recent install', () => {
    const info = distInfo('presence');
    placeTool({ appId: 'applet#old', distributionInfo: info, happSha256: A, uiSha256: B });
    placeTool({ appId: 'applet#new', distributionInfo: info, happSha256: C, uiSha256: D });
    // Make the second install unambiguously newer than the first.
    const older = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(dirs.happsDir, `${A}.happ`), older, older);

    const tools = listLocalTools(dirs);
    expect(tools).toHaveLength(1);
    expect(tools[0].happSha256).toBe(C);
  });

  it('ignores malformed or non-web2 entries without hiding the good ones', () => {
    fs.mkdirSync(path.join(dirs.appsDir, 'applet#broken'), { recursive: true });
    fs.writeFileSync(path.join(dirs.appsDir, 'applet#broken', 'info.json'), 'not json');
    fs.mkdirSync(path.join(dirs.appsDir, 'applet#empty'), { recursive: true });
    const happOnly: AppAssetsInfo = {
      type: 'happ',
      sha256: A,
      assetSource: { type: 'filesystem' },
      distributionInfo: { type: 'filesystem' },
    };
    fs.mkdirSync(path.join(dirs.appsDir, 'applet#happ'), { recursive: true });
    fs.writeFileSync(path.join(dirs.appsDir, 'applet#happ', 'info.json'), JSON.stringify(happOnly));
    placeTool({
      appId: 'applet#good',
      distributionInfo: distInfo('good'),
      happSha256: C,
      uiSha256: D,
    });

    const tools = listLocalTools(dirs);
    expect(tools.map((t) => t.happSha256)).toEqual([C]);
  });

  it('returns nothing when there are no installed apps at all', () => {
    fs.rmSync(dirs.appsDir, { recursive: true, force: true });
    expect(listLocalTools(dirs)).toEqual([]);
  });
});
