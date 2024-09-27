import { password as passwordInput } from '@inquirer/prompts';

import { WDockerFilesystem } from '../filesystem.js';
import { AdminWebsocket } from '@holochain/client';

export async function info(id: string) {
  const wDockerFs = new WDockerFilesystem();
  wDockerFs.setConductorId(id);
  const runningInfo = wDockerFs.readRunningFile();
  if (!runningInfo) {
    console.log(
      'Conductor must be running to show info. Run\n\n  wdocker start <name>\n\nto start a conductor.',
    );
    return;
  }

  const pw = await passwordInput({ message: 'conductor password:' });
  const runningSecretInfo = wDockerFs.readRunningSecretFile(pw);
  if (!runningSecretInfo) {
    console.log('Failed to connect to conductor. No port file found.');
    return;
  }
  const adminWs = await AdminWebsocket.connect({
    url: new URL(`ws://localhost:${runningSecretInfo?.adminPort}`),
    wsClientOptions: { origin: runningSecretInfo.allowedOrigin },
  });

  const listAppsResponse = await adminWs.listApps({});
  console.log('Installed Apps: ', listAppsResponse);
}
