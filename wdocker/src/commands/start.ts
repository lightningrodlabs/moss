import path from 'path';
import fs from 'fs';

import { startDaemon } from '../daemon/start.js';
import { WDockerFilesystem } from '../filesystem.js';

export async function start(id: string): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  const conductorDataDir = path.join(wDockerFs.allConductorsDir, id);
  if (!fs.existsSync(conductorDataDir)) {
    console.log(
      `There is no conductor with name '${id}'. Run\n\n  wdocker run <name>\n\nto initialize and run a new conductor.`,
    );
    return;
  }
  startDaemon(id, false);
}
