import path from 'path';
import fs from 'fs';

import { startDaemon } from '../daemon/start.js';
import { WDockerFilesystem } from '../filesystem.js';

export async function run(id: string): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  const conductorDataDir = path.join(wDockerFs.allConductorsDir, id);
  if (fs.existsSync(conductorDataDir)) {
    console.log(
      `A conductor with name '${id}' already exists. Use\n\n  wdocker start <name>\n\nto start an existing conductor.`,
    );
    return;
  }
  startDaemon(id, true);
}
