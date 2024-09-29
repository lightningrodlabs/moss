import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import rustUtils from '@lightningrodlabs/we-rust-utils';
import Table from 'cli-table';

import {
  AdminWebsocket,
  AppWebsocket,
  CallZomeTransform,
  CellId,
  CellInfo,
  InstalledAppId,
} from '@holochain/client';
import { password as passwordInput } from '@inquirer/prompts';

import { WDockerFilesystem } from '../filesystem.js';
import { GROUP_HAPP_URL, MOSS_CONFIG, TOOLS_LIBRARY_URL } from '../const.js';
import { downloadFile, signZomeCall } from '../utils.js';
import { decode } from '@msgpack/msgpack';

export async function getPassword(): Promise<string> {
  return passwordInput({ message: 'conductor password:' });
}

export async function getAdminWs(id: string, password: string): Promise<AdminWebsocket> {
  const wDockerFs = new WDockerFilesystem();
  wDockerFs.setConductorId(id);
  const runningInfo = wDockerFs.readRunningSecretFile(password);
  if (!runningInfo)
    throw new Error(
      'Failed to connect to admin websocket: No port file found. Make sure that the conductor is running.',
    );
  return AdminWebsocket.connect({
    url: new URL(`ws://localhost:${runningInfo.adminPort}`),
    wsClientOptions: { origin: runningInfo.allowedOrigin },
  });
}

export async function getAdminWsAndAppPort(
  id: string,
  password: string,
): Promise<{ adminWs: AdminWebsocket; appPort: number }> {
  const adminWs = await getAdminWs(id, password);
  // Get or attach app interface
  const appInterfaces = await adminWs.listAppInterfaces();
  let appPort: number;
  if (appInterfaces.length > 0) {
    appPort = appInterfaces[0].port;
  } else {
    const attachAppInterfaceResponse = await adminWs.attachAppInterface({
      allowed_origins: 'wdocker',
    });
    console.log('Attached app interface port: ', attachAppInterfaceResponse);
    appPort = attachAppInterfaceResponse.port;
  }
  return {
    adminWs,
    appPort,
  };
}

export async function getAppWs(
  adminWs: AdminWebsocket,
  appPort: number,
  installedAppId: InstalledAppId,
  weRustHandler: rustUtils.WeRustHandler,
): Promise<AppWebsocket> {
  const authTokenResponse = await adminWs.issueAppAuthenticationToken({
    installed_app_id: installedAppId,
    expiry_seconds: 10,
    single_use: true,
  });
  const callZomeTransform: CallZomeTransform = {
    input: (req) => signZomeCall(req, weRustHandler),
    output: (o) => decode(o as any),
  };
  return AppWebsocket.connect({
    url: new URL(`ws://localhost:${appPort}`),
    token: authTokenResponse.token,
    callZomeTransform,
    wsClientOptions: {
      origin: 'wdocker',
    },
  });
}

export async function getWeRustHandler(
  wDockerFs: WDockerFilesystem,
  password: string,
): Promise<rustUtils.WeRustHandler> {
  const lairUrl = wDockerFs.readLairUrl();
  if (!lairUrl) throw new Error('Failed to read lair connection url');
  return rustUtils.WeRustHandler.connect(lairUrl, password);
}

/**
 * Downloads the group happ from github if necessary
 */
export async function downloadGroupHappIfNecessary() {
  const wDockerFs = new WDockerFilesystem();
  const happSha256 = MOSS_CONFIG.groupHapp.sha256;
  if (!happSha256) throw new Error('Group happ sha256 undefined.');

  // Check presence and integrity of group happ
  let needsToBeFetched = false;
  const groupHappPath = wDockerFs.happFilePath(happSha256);
  if (fs.existsSync(groupHappPath)) {
    const fileBytes = fs.readFileSync(groupHappPath);
    const hasher = crypto.createHash('sha256');
    hasher.update(fileBytes);
    const sha256Hex = hasher.digest('hex');
    if (sha256Hex !== happSha256) {
      needsToBeFetched = true;
      console.warn(
        `sha256 of the group happ found does not match the expected sha256, indicating that the happ file got corrupted. Got ${sha256Hex} but expected ${happSha256}`,
      );
    }
  } else {
    needsToBeFetched = true;
  }

  if (needsToBeFetched) {
    downloadFile(GROUP_HAPP_URL, groupHappPath, happSha256, false);
  }
}

/**
 * Downloads the tool library happ from github if necessary
 */
export async function downloadToolLibraryHappIfNecessary(): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  const happSha256 = MOSS_CONFIG.toolsLibrary.sha256;
  if (!happSha256) throw new Error('Tool library happ sha256 undefined.');

  // Check presence and integrity of group happ
  let needsToBeFetched = false;
  const toolLibraryHappPath = path.join(wDockerFs.happsDir, `${happSha256}.happ`);
  if (fs.existsSync(toolLibraryHappPath)) {
    const fileBytes = fs.readFileSync(toolLibraryHappPath);
    const hasher = crypto.createHash('sha256');
    hasher.update(fileBytes);
    const sha256Hex = hasher.digest('hex');
    if (sha256Hex !== happSha256) {
      needsToBeFetched = true;
      console.warn(
        `sha256 of the tool library happ found does not match the expected sha256, indicating that the happ file got corrupted. Got ${sha256Hex} but expected ${happSha256}`,
      );
    }
  } else {
    needsToBeFetched = true;
  }

  if (needsToBeFetched) {
    await downloadFile(TOOLS_LIBRARY_URL, toolLibraryHappPath, happSha256, false);
  }
}

export function cleanTable() {
  return new Table({
    chars: {
      top: '',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: '',
      'left-mid': '',
      mid: '',
      'mid-mid': '',
      right: '',
      'right-mid': '',
      middle: ' ',
    },
    style: { 'padding-left': 0, 'padding-right': 10 },
  });
}

export function getCellId(cellInfo: CellInfo): CellId | undefined {
  if ('provisioned' in cellInfo) {
    return cellInfo.provisioned.cell_id;
  }
  if ('cloned' in cellInfo) {
    return cellInfo.cloned.cell_id;
  }
  return undefined;
}
