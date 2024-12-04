import crypto from 'crypto';
import yaml from 'js-yaml';
import path from 'path';
import fs from 'fs';
import os from 'os';

import { nanoid } from 'nanoid';
import { partialModifiersFromInviteLink } from '@theweave/utils';
import { AdminWebsocket, AppInfo, encodeHashToBase64 } from '@holochain/client';
import { input } from '@inquirer/prompts';

import { TOOLS_LIBRARY_APP_ID } from '@theweave/moss-types';
import {
  downloadGroupHappIfNecessary,
  getAdminWsAndAppPort,
  getAppWs,
  getPassword,
  getWeRustHandler,
} from '../../helpers/helpers.js';
import { WDockerFilesystem } from '../../filesystem.js';
import rustUtils from '@lightningrodlabs/we-rust-utils';

export async function joinGroup(conductorId: string, inviteLink: string): Promise<AppInfo | null> {
  const wDockerFs = new WDockerFilesystem();
  if (!wDockerFs.conductorExists(conductorId)) {
    console.log(`A conductor with name '${conductorId}' does not exist.`);
    return Promise.resolve(null);
  }
  wDockerFs.setConductorId(conductorId);
  const password = await getPassword();
  const config = wDockerFs.wdockerConductorConfig;
  const profileName = await input({
    message: 'How do you want this node to be named inside the group?',
    default: config.defaultProfileName,
  });
  const wdockerNodeDescription = await input({
    message: 'Choose a description for this node',
    default: config.defaultNodeDescription,
  });
  wDockerFs.setWdockerConductorConfig({
    ...config,
    defaultNodeDescription: wdockerNodeDescription,
    defaultProfileName: profileName,
  });
  console.log('Getting admin ws');
  const { adminWs, appPort } = await getAdminWsAndAppPort(conductorId, password);
  console.log('Installing group');
  const appInfo = await installGroup(inviteLink, adminWs, wDockerFs);
  console.log('Creating profile');
  const weRustHandler = await getWeRustHandler(wDockerFs, password);
  const groupAppWs = await getAppWs(adminWs, appPort, appInfo.installed_app_id, weRustHandler);
  await groupAppWs.callZome({
    role_name: 'group',
    zome_name: 'profiles',
    fn_name: 'create_profile',
    payload: {
      nickname: profileName,
      fields: {
        wdockerNode: wdockerNodeDescription,
      },
    },
  });
  console.log('Group joined successfully.');

  // Create profile in group

  adminWs.client.close();
  return appInfo;
}

export async function installGroup(
  inviteLink: string,
  adminWs: AdminWebsocket,
  wDockerFs: WDockerFilesystem,
): Promise<AppInfo> {
  // Download the group happ from github if necessary
  await downloadGroupHappIfNecessary();

  // install group into conductor
  const partialModifiers = partialModifiersFromInviteLink(inviteLink);
  if (!partialModifiers) throw new Error('Invite link seems to be invalid.');

  console.log('Listing apps');

  const apps = await adminWs.listApps({});
  const toolLibraryAppInfo = apps.find(
    (appInfo) => appInfo.installed_app_id === TOOLS_LIBRARY_APP_ID,
  );
  if (!toolLibraryAppInfo)
    throw new Error('Tool library must be installed before installing the first group.');

  const hash = crypto.createHash('sha256');
  hash.update(partialModifiers.networkSeed);
  const hashedSeed = hash.digest('base64');
  const appId = `group#${hashedSeed}#${partialModifiers.progenitor ? encodeHashToBase64(toolLibraryAppInfo.agent_pub_key) : null}`;

  const dnaPropertiesMap = partialModifiers.progenitor
    ? {
        group: yaml.dump({ progenitor: partialModifiers.progenitor }),
      }
    : {
        group: yaml.dump({
          progenitor: null,
        }),
      };

  console.log('Modifying happ bytes');

  const modifiedHappBytes = await rustUtils.happBytesWithCustomProperties(
    wDockerFs.groupHappPath,
    dnaPropertiesMap,
  );

  const modifiedHappPath = path.join(os.tmpdir(), `group-happ-${nanoid(8)}.happ`);

  fs.writeFileSync(modifiedHappPath, new Uint8Array(modifiedHappBytes));

  console.log('Installing app');

  const appInfo = await adminWs.installApp({
    path: modifiedHappPath,
    installed_app_id: appId,
    agent_key: toolLibraryAppInfo.agent_pub_key,
    network_seed: partialModifiers.networkSeed,
  });
  fs.rmSync(modifiedHappPath);

  console.log('Enabling app');

  await adminWs.enableApp({ installed_app_id: appId });

  return appInfo;
}
