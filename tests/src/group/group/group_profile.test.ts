import { assert, test } from 'vitest';

import { runScenario, dhtSync } from '@holochain/tryorama';
import { fakeAgentPubKey, Record as HolochainRecord } from '@holochain/client';
import { EntryRecord } from '@holochain-open-dev/utils';

import { getCellByRoleName, GROUP_HAPP_PATH } from '../../shared.js';
import { installAppWithProgenitor, twoAgentsOneProgenitorAndOneSteward } from './common.js';
import { GroupProfile } from '@theweave/group-client';
import { fail } from 'assert';

// This test is currently not in use since the progenitor pattern is not supported in tryorama
test('Create, read and update group profile in group without progenitor', async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = GROUP_HAPP_PATH;
    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    // Add 2 players with the test app to the Scenario. The returned players
    // can be destructured.
    const [alice, alicePubKey] = await installAppWithProgenitor(
      scenario,
      appSource.appBundleSource,
      ['group'],
      false,
    );

    const [bob, bobPubKey] = await installAppWithProgenitor(
      scenario,
      appSource.appBundleSource,
      ['group'],
      false,
    );

    // Shortcut peer discovery through gossip and register all agents in every
    // conductor of the scenario.
    await scenario.shareAllAgents();
    const groupCellAlice = getCellByRoleName(alice, 'group');
    const groupCellBob = getCellByRoleName(bob, 'group');
    // 1. Alice creates a group profile
    const input: GroupProfile = {
      name: 'Tennis Club',
      icon_src: 'base64pngetc',
      meta_data: 'too meta to put here',
      permission_hash: null,
    };
    await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'set_group_profile',
      payload: input,
    });
    // Alice reads it
    const groupProfileRecord: HolochainRecord | undefined = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_group_profile',
      payload: null,
    });
    const r1 = groupProfileRecord ? new EntryRecord(groupProfileRecord) : undefined;
    assert(!!groupProfileRecord);
    assert.deepEqual(r1.entry, input);
    await dhtSync([alice, bob], groupCellAlice.cell_id[0]);
    // Bob can read it too
    const groupProfileRecord2: HolochainRecord | undefined = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_group_profile',
      payload: null,
    });
    const r2 = groupProfileRecord2 ? new EntryRecord(groupProfileRecord2) : undefined;
    assert(!!groupProfileRecord2);
    assert.deepEqual(r2.entry, input);

    // Bob can update the group profile since it's an unstewarded group
    const input2: GroupProfile = {
      name: 'Tennis Club 2',
      icon_src: 'base64pngetc',
      meta_data: 'too meta to put here',
      permission_hash: null,
    };
    await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'set_group_profile',
      payload: input2,
    });

    await dhtSync([alice, bob], groupCellAlice.cell_id[0]);

    // Alice reads the updated group profile
    const groupProfileRecord3: HolochainRecord | undefined = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_group_profile',
      payload: null,
    });
    const r3 = groupProfileRecord3 ? new EntryRecord(groupProfileRecord3) : undefined;
    assert(!!groupProfileRecord3);
    assert.deepEqual(r3.entry, input2);
  });
});

// TODO
// - test that profile cannot be updated without steward permission
// -

test('Cannot create group profile if not progenitor or without valid steward permission', async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = GROUP_HAPP_PATH;
    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    // Add 2 players with the test app to the Scenario. The returned players
    // can be destructured.
    const [alice, alicePubKey] = await installAppWithProgenitor(
      scenario,
      appSource.appBundleSource,
      ['group'],
      true,
      await fakeAgentPubKey(),
    );

    const groupCellAlice = getCellByRoleName(alice, 'group');
    // 1. Alice tries to create a group profile without permission_hash
    const input: GroupProfile = {
      name: 'Tennis Club',
      icon_src: 'base64pngetc',
      meta_data: 'too meta to put here',
      permission_hash: null,
    };
    try {
      await groupCellAlice.callZome({
        zome_name: 'group',
        fn_name: 'set_group_profile',
        payload: input,
      });
      fail(
        'Alice should not be allowed to create a group profile without being progenitor or having a valid steward permission.',
      );
    } catch (e) {
      if (
        !e.toString().includes('No valid permission hash provided and agent is not the progenitor')
      ) {
        fail(
          'Alice should not be allowed to create a group profile without being progenitor or having a valid steward permission.',
        );
      }
    }
  });
});

test('Can update group profile with valid steward permission', async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = GROUP_HAPP_PATH;
    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    const [[alice, alicePubKey], [bob, bobPubKey, bobPermissionHash]] =
      await twoAgentsOneProgenitorAndOneSteward(scenario, appSource.appBundleSource, ['group']);

    const groupCellBob = getCellByRoleName(bob, 'group');
    const groupCellAlice = getCellByRoleName(alice, 'group');

    // 1. Bob creates group profile with valid steward permission
    const input: GroupProfile = {
      name: 'Tennis Club',
      icon_src: 'base64pngetc',
      meta_data: 'too meta to put here',
      permission_hash: bobPermissionHash,
    };

    await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'set_group_profile',
      payload: input,
    });

    await dhtSync([alice, bob], groupCellAlice.cell_id[0]);

    // Alice reads the group profile set by Bob
    const groupProfileRecord: HolochainRecord | undefined = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_group_profile',
      payload: null,
    });
    const r1 = groupProfileRecord ? new EntryRecord(groupProfileRecord) : undefined;
    assert(!!groupProfileRecord);
    assert.deepEqual(r1.entry, input);
    await dhtSync([alice, bob], groupCellAlice.cell_id[0]);
  });
});

test('Can update group profile as long as steward permission has not expired', async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = GROUP_HAPP_PATH;
    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    // Bob's permission shall expire in 90 seconds
    const expiry = (Date.now() + 90_000) * 1_000;

    const [[alice, alicePubKey], [bob, bobPubKey, bobPermissionHash]] =
      await twoAgentsOneProgenitorAndOneSteward(
        scenario,
        appSource.appBundleSource,
        ['group'],
        expiry,
      );

    const groupCellBob = getCellByRoleName(bob, 'group');
    const groupCellAlice = getCellByRoleName(alice, 'group');

    // 1. Bob creates group profile with valid steward permission
    const input: GroupProfile = {
      name: 'Tennis Club',
      icon_src: 'base64pngetc',
      meta_data: 'too meta to put here',
      permission_hash: bobPermissionHash,
    };

    await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'set_group_profile',
      payload: input,
    });

    const timeUntilExpiry = expiry / 1000 - Date.now();

    const failure = await new Promise((resolve) =>
      setTimeout(async () => {
        const input2: GroupProfile = {
          name: 'Tennis Club2',
          icon_src: 'base64pngetc',
          meta_data: 'too meta to put here',
          permission_hash: bobPermissionHash,
        };
        try {
          const before = Date.now() * 1000;
          console.log(
            `Bob tries to set the group profile...\nTime now: ${before}\nExpiry: ${expiry}\nTime until expiry: ${expiry - before}`,
          );
          const record: HolochainRecord = await groupCellBob.callZome({
            zome_name: 'group',
            fn_name: 'set_group_profile',
            payload: input2,
          });

          console.log('Record action timestamp: ', record.signed_action.hashed.content.timestamp);
          // Getting to this point is a failure since setting the profile should have been
          // rejected due to an expired permission

          const now = Date.now() * 1000;
          console.log(
            `OH NO! Bob was able to set the group profile.\nTime now: ${now}\nExpiry: ${expiry}\nTime until expiry: ${expiry - now}`,
          );
          resolve(true);
        } catch (e) {
          if (e.toString().includes('StewardPermission has expired')) {
            // This is the case we want so resolve with false
            resolve(false);
          }
        }
        // Getting to this point is a failure since setting the profile should have been
        // rejected due to an expired permission
        resolve(true);
      }, timeUntilExpiry),
    );
    if (failure) {
      const now = Date.now() * 1000;
      fail(
        `Bob should not be allowed to create a group profile after the steward permission has expired.\nTime now: ${now}\nExpiry: ${expiry}\nTime until expiry: ${expiry - now}`,
      );
    }
  });
});
