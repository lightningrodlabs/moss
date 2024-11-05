import { assert, test } from 'vitest';

import { runScenario, dhtSync } from '@holochain/tryorama';
import { fakeActionHash } from '@holochain/client';
import { WAL } from '@theweave/api';

import { getCellByRoleName, GROUP_HAPP_PATH } from '../../shared.js';

type TagsToAssetInput = {
  wal: WAL;
  tags: string[];
};

test('Add and remove tags from asset', async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = GROUP_HAPP_PATH;

    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    // Add 2 players with the test app to the Scenario. The returned players
    // can be destructured.
    const [alice, bob] = await scenario.addPlayersWithApps([appSource, appSource]);

    // Shortcut peer discovery through gossip and register all agents in every
    // conductor of the scenario.
    await scenario.shareAllAgents();

    const assetsCellAlice = getCellByRoleName(alice, 'assets');
    const assetsCellBob = getCellByRoleName(bob, 'assets');

    // 1. Alice adds tags to asset and both Alice and Bob try to read them
    const wal: WAL = {
      hrl: [assetsCellAlice.cell_id[0], await fakeActionHash()],
      context: new Uint8Array(4),
    };

    const input: TagsToAssetInput = {
      wal,
      tags: ['cool', 'fancy', 'random tag'],
    };
    await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'add_tags_to_asset',
      payload: input,
    });

    // Alice tries to read them
    const tagsReadByAlice: string[] = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'get_tags_for_asset',
      payload: wal,
    });

    assert(
      tagsReadByAlice.includes('cool') &&
        tagsReadByAlice.includes('fancy') &&
        tagsReadByAlice.includes('random tag'),
    );

    await dhtSync([alice, bob], assetsCellAlice.cell_id[0]);

    // Bob tries to read them
    const tagsReadByBob: string[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_tags_for_asset',
      payload: wal,
    });

    assert(
      tagsReadByBob.includes('cool') &&
        tagsReadByBob.includes('fancy') &&
        tagsReadByBob.includes('random tag'),
    );

    // Bob deletes the 'random tag' and both Alice and Bob should not see it anymore
    await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'remove_tags_from_asset',
      payload: {
        wal,
        tags: ['random tag'],
      },
    });

    // Bob tries to read them
    const tagsReadByBob2: string[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_tags_for_asset',
      payload: wal,
    });

    assert(
      tagsReadByBob2.includes('cool') &&
        tagsReadByBob2.includes('fancy') &&
        !tagsReadByBob2.includes('random tag'),
    );

    await dhtSync([alice, bob], assetsCellAlice.cell_id[0]);

    // Alice tries to read them
    const tagsReadByAlice2: string[] = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'get_tags_for_asset',
      payload: wal,
    });

    assert(
      tagsReadByAlice2.includes('cool') &&
        tagsReadByAlice2.includes('fancy') &&
        !tagsReadByAlice2.includes('random tag'),
    );
  });
});
