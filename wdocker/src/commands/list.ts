import { WDockerFilesystem } from '../filesystem.js';
import Table from 'cli-table';
import { format } from 'timeago.js';

export async function list(): Promise<void> {
  const wDockerFs = new WDockerFilesystem();
  const allConductorInfos = await wDockerFs.listConductors();
  const table = new Table({
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
  table.push(['CONDUCTOR ID', 'CREATED', 'STATUS', 'SIZE']);
  const infos = allConductorInfos.map((info) => [
    info.id,
    format(info.createdAt),
    info.status === 'running'
      ? info.startedAt
        ? `running (started ${format(info.startedAt)})`
        : 'Running (Unknown duration)'
      : 'stopped',
    info.size ? info.size : 'unknown size',
  ]);
  infos.forEach((info) => table.push(info));
  console.log(table.toString());
}

// export type ConductorInstanceInfo = {
//   id: string;
//   status: ConductorRunningStatus;
//   /**
//    * Timestamp when the conductor has been created initially
//    */
//   createdAt: number;
//   /**
//    * Timestamp when the conductor has been started, if it is currently running
//    */
//   startedAt?: number;
//   /**
//    * Total size in bytes
//    */
//   size?: number;
// };
