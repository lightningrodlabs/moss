import fs from 'fs';
import { confirm } from '@inquirer/prompts';
import { WDockerFilesystem } from '../filesystem.js';

export async function purgeConductor(conductorId: string) {
  const wDockerFs = new WDockerFilesystem();
  if (!wDockerFs.conductorExists(conductorId)) {
    console.log(`There is no conductor with name '${conductorId}'`);
    return;
  }
  wDockerFs.setConductorId(conductorId);
  const envPurgeConfirm = process.env.WDOCKER_PURGE_CONFIRM;
  let confirmed: boolean;

  if (envPurgeConfirm !== undefined) {
    if (envPurgeConfirm === 'true') {
      confirmed = true;
    } else {
      console.log(
        "Purge aborted: set WDOCKER_PURGE_CONFIRM=true to confirm non-interactively.",
      );
      return;
    }
  } else {
    confirmed = await confirm({
      message: `Are you sure you want to delete this whole conductor?\nThis will irreversibly delete all data in ${wDockerFs.conductorDataDir}`,
    });
  }

  if (confirmed) {
    fs.rmSync(wDockerFs.conductorDataDir, { recursive: true });
    console.log('Conductor deleted.');
  }
}
