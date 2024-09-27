#!/usr/bin/env node

import { Command } from 'commander';

import { list } from './commands/list.js';
import { run } from './commands/run.js';
import { start } from './commands/start.js';
import { stopConductor } from './commands/stop.js';
import { purgeConductor } from './commands/purge.js';
import { info } from './commands/info.js';
import { listApps } from './commands/conductor/list-apps.js';
import { joinGroup } from './commands/conductor/join-group.js';
import { listGroups } from './commands/conductor/list-groups.js';
import { groupInfo } from './commands/conductor/group-info.js';
import os from 'os';

if (os.platform() === 'win32') throw new Error('wdocker is currently not supported on Windows.');

const wDocker = new Command();

wDocker.name('wdocker').description('Run always-online nodes for the Weave');

wDocker
  .command('run')
  .description('run a new conductor')
  .argument('<conductor-name>')
  // .option('-d, --detached', 'run detached as a background process')
  .action(async (conductorId, _opts) => {
    await run(conductorId, false);
  });

wDocker
  .command('start')
  .description('start an existing conductor')
  .argument('<conductor-name>')
  // .option('-d, --detached', 'run detached as a background process')
  .action(async (conductorId, _opts) => {
    await start(conductorId, false);
  });

wDocker
  .command('stop')
  .description('stop a running conductor')
  .argument('<conductor-name>')
  .action(async (conductorId) => {
    await stopConductor(conductorId);
  });

wDocker
  .command('purge')
  .description('Completely remove a conductor and delete all associated data.')
  .argument('<conductor-name>')
  .action(async (conductorId) => {
    await purgeConductor(conductorId);
  });

wDocker
  .command('info')
  .description('info about a running conductor')
  .argument('<conductor-name>')
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

/**
 * conductor command
 */

wDocker
  .command('list-apps')
  .description('list all installed apps for a conductor')
  .argument('<conductor-name>', 'id (name) of the conductor')
  .action(async (conductorId) => {
    const response = await listApps(conductorId);
    if (response) console.log('Installed apps: ', response);
    return;
  });

wDocker
  .command('list-groups')
  .description('list all joined groups for a conductor')
  .argument('<conductor-name>', 'id (name) of the conductor')
  .action(async (conductorId) => {
    await listGroups(conductorId);
  });

wDocker
  .command('group-info')
  .description('list all joined groups for a conductor')
  .argument('<conductor-name>', 'id (name) of the conductor')
  .argument('<group-dna-hash>', 'dna hash of the group')
  .option('--verbose', 'show verbose output')
  .action(async (conductorId, dnaHash, opts) => {
    await groupInfo(conductorId, dnaHash, opts.verbose);
  });

wDocker
  .command('join-group')
  .description('Join a Moss group with a conductor')
  .argument('<conductor-name>', 'id (name) of the conductor in which to install the group')
  .argument('<invite-link-in-quotes>', 'invite link to the group, MUST BE WRAPPED in quotes ""')
  .action(async (conductorId, inviteLink) => {
    if (!inviteLink.includes('&progenitor')) {
      console.warn(
        'WARNING: It looks like you may not have wrapped the <invite-link> argument in quotes "". This is required for the command to work.',
      );
    }
    console.log(
      'Got join-group command with conductorId and inviteLink: ',
      conductorId,
      inviteLink,
    );
    const response = await joinGroup(conductorId, inviteLink);
    if (response) console.log('Joined group:\n', response);
    process.exit(0);
  });

wDocker.parse();
