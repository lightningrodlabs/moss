import { Command } from 'commander';

import xdg from '@folder/xdg';

import packageJson from './../package.json' assert { type: 'json' };
import { WDockerFilesystem } from './filesystem.js';
import { startConductor } from './commands/start.js';

console.log(packageJson.version);

// import * as childProcess from 'child_process';

console.log('Hello!');

const hDocker = new Command();

hDocker.name('wdocker').description('Run always-online nodes for the Weave');

hDocker
  .command('run')
  .description('run a new conductor')
  .argument('<name>')
  .option('-d, --daemon', 'run as a background daemon')
  .action((arg, opts) => {
    console.log('Got inputs: ', arg, opts);
    console.log('Started imaginary background conductor.');
  });

hDocker
  .command('start')
  .description('start an existing conductor')
  .argument('<name>')
  .action(async (arg, _opts) => {
    console.log(`Starting conductor with id '${arg}'`);
    await startConductor(arg, 'test');
  });

// .addCommand(
//   new Command('run <name>')
//     .description('run a new conductor')
//     .option('-d', '--daemon', 'run as a daemon')
//     .action((actionContent) => {
//       console.log('actionContent: ', actionContent);
//     }),
// )
// .addCommand(new Command('start <name>').description('start an existing conductor'));

hDocker.parse();

const dirs = xdg();
console.log(dirs.data);

const wDockerFs = new WDockerFilesystem('test');

const allConductors = wDockerFs.listConductors();
console.log('all conductors: ', allConductors);

hDocker.commands[0];

// wDockerFs.storeRunningFile(
//   {
//     adminPort: 1234,
//     allowedOrigin: 'abc',
//     pid: 234123,
//   },
//   'test',
// );

// const readContent = wDockerFs.readRunningFile('test');

// console.log('READ CONTENT: ', readContent);
