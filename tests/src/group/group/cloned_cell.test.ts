import { assert, test } from 'vitest';

import { runScenario, dhtSync } from '@holochain/tryorama';
import {
  AppBundleSource,
  encodeHashToBase64,
  EntryHash,
  fakeDnaHash,
  fakeEntryHash,
} from '@holochain/client';

import { getCellByRoleName, GROUP_HAPP_PATH } from '../../shared.js';
import { AppletClonedCell } from '@theweave/group-client';

// This test is currently not in use since the progenitor pattern is not supported in tryorama
test('join a cloned cell and test unjoined cells', async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = GROUP_HAPP_PATH;

    const appBundleSource: AppBundleSource = {
      type: 'path',
      value: testAppPath,
    };

    // Set up the app to be installed
    const appSource = {
      appBundleSource,
    };
    // Add 2 players with the test app to the Scenario. The returned players
    // can be destructured.
    const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);
    // Shortcut peer discovery through gossip and register all agents in every
    // conductor of the scenario.
    await scenario.shareAllAgents();
    const groupCellAlice = getCellByRoleName(alice, 'group');
    const groupCellBob = getCellByRoleName(bob, 'group');

    const appletHash = await fakeEntryHash();
    const cloneCell: AppletClonedCell = {
      applet_hash: appletHash,
      dna_hash: await fakeDnaHash(),
      role_name: 'some test role',
      network_seed: 'blabla',
      properties: new Uint8Array(),
    };
    //- Alice joins a cloned cell
    const clonedCellEntryHash: EntryHash = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'join_cloned_cell',
      payload: cloneCell,
    });

    //- Alice shuould now have zero unjoined cloned cells
    const unjoinedClones: EntryHash[] = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_unjoined_cloned_cells_for_applet',
      payload: appletHash,
    });

    console.log('unjoinedClones', unjoinedClones);

    assert(unjoinedClones.length === 0);

    await dhtSync([alice, bob], groupCellAlice.cell_id[0]);

    //- Bob should now see it too but as unjoined
    const cloneEntryHashes: EntryHash[] = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_all_cloned_cell_entry_hashes_for_applet',
      payload: appletHash,
    });

    assert(
      cloneEntryHashes.length === 1 &&
        encodeHashToBase64(cloneEntryHashes[0]) === encodeHashToBase64(clonedCellEntryHash),
    );

    const cloneEntries: AppletClonedCell[] = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_all_cloned_cells_for_applet',
      payload: appletHash,
    });

    assert(cloneEntries.length === 1);
    assert.deepEqual(cloneEntries[0], cloneCell);

    const unjoinedClonesBob: EntryHash[] = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_unjoined_cloned_cells_for_applet',
      payload: appletHash,
    });

    assert(
      unjoinedClonesBob.length === 1 &&
        encodeHashToBase64(unjoinedClonesBob[0]) === encodeHashToBase64(clonedCellEntryHash),
    );

    //- Bob joins it too and should then see no unjoined clones anymore
    const appletClonedCell: AppletClonedCell = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_applet_cloned_cell',
      payload: unjoinedClonesBob[0],
    });

    assert(!!appletClonedCell);
    assert.deepEqual(appletClonedCell, cloneCell);

    const clonedCellEntryHashBob = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'join_cloned_cell',
      payload: cloneCell,
    });

    assert.deepEqual(clonedCellEntryHash, clonedCellEntryHashBob);

    const unjoinedClonesBob2: EntryHash[] = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_unjoined_cloned_cells_for_applet',
      payload: appletHash,
    });

    assert(unjoinedClonesBob2.length === 0);

    //- Test that Bob can still get the applet cloned cell (this time it will be
    //  read from the source chain instead of the DHT)
    const appletClonedCell2: AppletClonedCell = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_applet_cloned_cell',
      payload: clonedCellEntryHashBob,
    });

    assert(!!appletClonedCell2);
    assert.deepEqual(appletClonedCell2, cloneCell);
  });
});
