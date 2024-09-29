import psList from 'ps-list';
import { WDockerFilesystem } from '../filesystem.js';
import { HOLOCHAIN_BINARY_NAME } from '../const.js';

/**
 * Stops a running conductor and the associated wdaemon
 *
 * @param id conductor ID
 */
export async function stopConductor(id: string): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  wDockerFs.setConductorId(id);
  const runningInfo = wDockerFs.readRunningFile();
  if (!runningInfo) {
    console.log(`Conductor '${id}' was not running.`);
    return;
  }
  const { conductorPid, daemonPid } = runningInfo;
  // console.log(conductorPid, daemonPid);
  const procs = await psList();
  const conductorProcess = procs.find((proc) => proc.pid === conductorPid);
  const daemonProcess = procs.find((proc) => proc.pid === daemonPid);

  if (conductorProcess) {
    // console.log('conductorProcess: ', conductorProcess);
    if (conductorProcess.name.startsWith(HOLOCHAIN_BINARY_NAME.slice(0, 14))) {
      process.kill(conductorPid);
    }
  }
  if (daemonProcess) {
    // console.log('daemonProcess: ', daemonProcess);
    const cmdParts = daemonProcess.cmd?.split(' ');
    if (cmdParts && cmdParts[1] && cmdParts[1].endsWith('wdaemon')) {
      process.kill(daemonPid);
    }
  }
  wDockerFs.clearRunningFile();
  wDockerFs.clearRunningSecretFile();
  console.log(`Conductor '${id}' stopped.`);
}
