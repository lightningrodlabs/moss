#!/usr/bin/env node

import { Command } from 'commander';

import { list } from './commands/list.js';
import { run } from './commands/run.js';
import { start } from './commands/start.js';
import { stopConductor } from './commands/stop.js';
import { info } from './commands/info.js';
import os from 'os';

if (os.platform() === 'win32') throw new Error('wdocker is currently not supported on Windows.');

const wDocker = new Command();

wDocker.name('wdocker').description('Run always-online nodes for the Weave');

wDocker
  .command('run')
  .description('run a new conductor')
  .argument('<name>')
  .option('-d, --detached', 'run detached as a background process')
  .action(async (conductorId, _opts) => {
    await run(conductorId);
  });

wDocker
  .command('start')
  .description('start an existing conductor')
  .argument('<name>')
  .option('-d, --detached', 'run detached as a background process')
  .action(async (conductorId) => {
    await start(conductorId);
    // process.exit();
  });

wDocker
  .command('stop')
  .description('stop a running conductor')
  .argument('<name>')
  .action(async (conductorId) => {
    await stopConductor(conductorId);
  });

wDocker
  .command('info')
  .description('info about a running conductor')
  .argument('<name>')
  .action(async (conductorId) => {
    await info(conductorId);
    process.exit(0);
  });

wDocker
  .command('list')
  .description('List all conductors')
  .action(async () => {
    await list();
  });

wDocker.parse();

// function collectPassword(): Promise<string> {

// }
