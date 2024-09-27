import { startDaemon } from '../daemon/start.js';
import { WDockerFilesystem } from '../filesystem.js';

export async function start(id: string): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  if (!wDockerFs.conductorExists(id)) {
    console.log(
      `There is no conductor with name '${id}'. Run\n\n  wdocker run <name>\n\nto initialize and run a new conductor.`,
    );
    return;
  }
  startDaemon(id, false);
}
