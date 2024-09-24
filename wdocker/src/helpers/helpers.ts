import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

import { AdminWebsocket } from '@holochain/client';
import passwordInput from '@inquirer/password';

import { WDockerFilesystem } from '../filesystem.js';
import { GROUP_HAPP_URL, MOSS_CONFIG, TOOLS_LIBRARY_URL } from '../const.js';
import { downloadFile } from '../utils.js';

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

/**
 * Downloads the group happ from github if necessary
 */
export async function downloadGroupHappIfNecessary() {
  const wDockerFs = new WDockerFilesystem();
  const happSha256 = MOSS_CONFIG.groupHapp.sha256;
  if (!happSha256) throw new Error('Group happ sha256 undefined.');

  // Check presence and integrity of group happ
  let needsToBeFetched = false;
  const groupHappPath = path.join(wDockerFs.happsDir, `${happSha256}.happ`);
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
