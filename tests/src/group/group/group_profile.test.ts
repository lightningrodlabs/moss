import { assert, test } from 'vitest';

import { runScenario, dhtSync } from '@holochain/tryorama';
import { GroupProfile, WAL } from '@theweave/api';
import { Record as HolochainRecord } from '@holochain/client';
import { EntryRecord } from '@holochain-open-dev/utils';

import { getCellByRoleName, GROUP_HAPP_PATH } from '../../shared.js';

// This test is currently not in use since the progenitor pattern is not supported in tryorama
test('Create, read and update group profile', async () => {
  await runScenario(async (scenario) => {
    //   // Construct proper paths for your app.
    //   // This assumes app bundle created by the `hc app pack` command.
    //   const testAppPath = GROUP_HAPP_PATH;
    //   // Set up the app to be installed
    //   const appSource = { appBundleSource: { path: testAppPath } };
    //   // Add 2 players with the test app to the Scenario. The returned players
    //   // can be destructured.
    //   const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
    //   // Shortcut peer discovery through gossip and register all agents in every
    //   // conductor of the scenario.
    //   await scenario.shareAllAgents();
    //   const assetsCellAlice = getCellByRoleName(alice, 'group');
    //   const assetsCellBob = getCellByRoleName(bob, 'group');
    //   // 1. Alice creates a group profile
    //   const input: GroupProfile = {
    //     name: 'Tennis Club',
    //     icon_src: 'base64pngetc',
    //     meta_data: 'too meta to put here',
    //   };
    //   // Alice reads it
    //   await assetsCellAlice.callZome({
    //     zome_name: 'group',
    //     fn_name: 'set_group_profile',
    //     payload: input,
    //   });
    //   const groupProfileRecord: HolochainRecord | undefined = await assetsCellAlice.callZome({
    //     zome_name: 'group',
    //     fn_name: 'get_group_profile',
    //     payload: null,
    //   });
    //   const r1 = groupProfileRecord ? new EntryRecord(groupProfileRecord) : undefined;
    //   assert(!!groupProfileRecord);
    //   assert.deepEqual(r1.entry, input);
    //   await dhtSync([alice, bob], assetsCellAlice.cell_id[0]);
  });
});
