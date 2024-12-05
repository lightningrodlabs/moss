import { assert, test } from 'vitest';

import { runScenario, dhtSync } from '@holochain/tryorama';
import { encodeHashToBase64, fakeAgentPubKey, Record as HolochainRecord } from '@holochain/client';

import { getCellByRoleName, GROUP_HAPP_PATH } from '../../shared.js';
import {
  sleep,
  threeAgentsOneProgenitorOneStewardOneMember,
  twoAgentsOneProgenitorAndOneSteward,
} from './common.js';
import { PermissionType, StewardPermission } from '@theweave/group-client';
import { fail } from 'assert';

test('Create unlimited steward permission and retrieve it in different ways', async () => {
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

    // Check that Alice is progenitor
    const permissionTypeAlice: PermissionType = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_my_permission_type',
      payload: null,
    });

    assert(permissionTypeAlice.type === 'Progenitor');

    const permissionTypeAlice2: PermissionType = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_permission_type',
      payload: alicePubKey,
    });

    assert(permissionTypeAlice2.type === 'Progenitor');

    // Get permission type of Bob and verify that it's of type Steward and has no expiry
    const permissionTypeBob: PermissionType = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_permission_type',
      payload: bobPubKey,
    });

    assert(permissionTypeBob.type === 'Steward');
    assert(
      encodeHashToBase64(permissionTypeBob.content.permission.for_agent) ===
        encodeHashToBase64(bobPubKey),
    );
    assert(!permissionTypeBob.content.permission.expiry);
    // This should be undefined/null since it has been created by the progenitor (Alice)
    assert(!permissionTypeBob.content.permission.permission_hash);
    assert(
      encodeHashToBase64(permissionTypeBob.content.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );

    // Bob gets his own permission type
    const permissionTypeBob2: PermissionType = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_my_permission_type',
      payload: null,
    });

    assert(permissionTypeBob2.type === 'Steward');
    assert(
      encodeHashToBase64(permissionTypeBob2.content.permission.for_agent) ===
        encodeHashToBase64(bobPubKey),
    );
    assert(!permissionTypeBob2.content.permission.expiry);
    // This should be undefined/null since it has been created by the progenitor (Alice)
    assert(!permissionTypeBob2.content.permission.permission_hash);
    assert(
      encodeHashToBase64(permissionTypeBob2.content.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );

    // Get permission type of Bob and verify that it's of type Steward and has no expiry
    const permissionTypeBob3: PermissionType = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_permission_type',
      payload: bobPubKey,
    });

    assert(permissionTypeBob3.type === 'Steward');
    assert(
      encodeHashToBase64(permissionTypeBob3.content.permission.for_agent) ===
        encodeHashToBase64(bobPubKey),
    );
    assert(!permissionTypeBob3.content.permission.expiry);
    // This should be undefined/null since it has been created by the progenitor (Alice)
    assert(!permissionTypeBob3.content.permission.permission_hash);
    assert(
      encodeHashToBase64(permissionTypeBob3.content.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );
  });
});

test('Create expiring steward permission and retrieve it in different ways', async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = GROUP_HAPP_PATH;
    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    const expiry = (Date.now() + 60_000) * 1_000;

    const [[alice, alicePubKey], [bob, bobPubKey, bobPermissionHash]] =
      await twoAgentsOneProgenitorAndOneSteward(
        scenario,
        appSource.appBundleSource,
        ['group'],
        expiry,
      );

    const groupCellBob = getCellByRoleName(bob, 'group');
    const groupCellAlice = getCellByRoleName(alice, 'group');

    // Get permission type of Bob and verify that it's of type Steward and has the correct expiry
    const permissionTypeBob: PermissionType = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_permission_type',
      payload: bobPubKey,
    });

    assert(permissionTypeBob.type === 'Steward');
    assert(
      encodeHashToBase64(permissionTypeBob.content.permission.for_agent) ===
        encodeHashToBase64(bobPubKey),
    );
    assert.equal(permissionTypeBob.content.permission.expiry, expiry);
    // This should be undefined/null since it has been created by the progenitor (Alice)
    assert(!permissionTypeBob.content.permission.permission_hash);
    assert(
      encodeHashToBase64(permissionTypeBob.content.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );

    // Bob gets his own permission type
    const permissionTypeBob2: PermissionType = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_my_permission_type',
      payload: null,
    });

    assert(permissionTypeBob2.type === 'Steward');
    assert(
      encodeHashToBase64(permissionTypeBob2.content.permission.for_agent) ===
        encodeHashToBase64(bobPubKey),
    );
    assert.equal(permissionTypeBob2.content.permission.expiry, expiry);
    // This should be undefined/null since it has been created by the progenitor (Alice)
    assert(!permissionTypeBob2.content.permission.permission_hash);
    assert(
      encodeHashToBase64(permissionTypeBob2.content.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );

    // Wait until expiry is over
    const timeUntilExpiry = expiry / 1000 - Date.now();
    await sleep(timeUntilExpiry);

    // Alice gets permission type of Bob which should now be of type Member since the Steward permission has expired
    const permissionTypeBob3: PermissionType = await groupCellAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_agent_permission_type',
      payload: bobPubKey,
    });

    assert(permissionTypeBob3.type === 'Member');

    // Bob gets his own permission type that should now be of type Member since the Steward permission has expired
    const permissionTypeBob4: PermissionType = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'get_my_permission_type',
      payload: null,
    });

    assert(permissionTypeBob4.type === 'Member');
  });
});

test('Steward can nominate additional stewards if their steward permission is not expiring', async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = GROUP_HAPP_PATH;
    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    const [
      [alice, alicePubKey],
      [bob, bobPubKey, bobPermissionHash],
      [neitherBobNorAlice, neitherBobNorAlicePubKey],
    ] = await threeAgentsOneProgenitorOneStewardOneMember(scenario, appSource.appBundleSource, [
      'group',
    ]);

    const groupCellAlice = getCellByRoleName(alice, 'group');
    const groupCellBob = getCellByRoleName(bob, 'group');
    const groupCellNeitherBobNorAlice = getCellByRoleName(neitherBobNorAlice, 'group');

    // Bob creates another steward permission for nbnoralice
    const input: StewardPermission = {
      for_agent: neitherBobNorAlicePubKey,
      permission_hash: bobPermissionHash,
    };

    const permissionRecord: HolochainRecord = await groupCellBob.callZome({
      zome_name: 'group',
      fn_name: 'create_steward_permission',
      payload: input,
    });

    await dhtSync([alice, bob, neitherBobNorAlice], groupCellAlice.cell_id[0]);

    // Check that permission type of nbnoralice is now indeed Steward
    const permissionTypeNbnoralice: PermissionType = await groupCellNeitherBobNorAlice.callZome({
      zome_name: 'group',
      fn_name: 'get_my_permission_type',
      payload: null,
    });

    assert(permissionTypeNbnoralice.type === 'Steward');
    assert(
      encodeHashToBase64(permissionTypeNbnoralice.content.permission.for_agent) ===
        encodeHashToBase64(neitherBobNorAlicePubKey),
    );
    assert(!permissionTypeNbnoralice.content.permission.expiry);
    // This should be undefined/null since it has been created by the progenitor (Alice)
    assert(!!permissionTypeNbnoralice.content.permission.permission_hash);
    assert(
      encodeHashToBase64(permissionTypeNbnoralice.content.permission.permission_hash) ===
        encodeHashToBase64(bobPermissionHash),
    );
    assert(
      encodeHashToBase64(permissionRecord.signed_action.hashed.hash) ===
        encodeHashToBase64(permissionTypeNbnoralice.content.permission_hash),
    );
  });
});

test('Steward can NOT nominate additional stewards if their steward permission is expiring', async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = GROUP_HAPP_PATH;
    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    // Expiry is far in the future
    const expiry = (Date.now() + 600_000) * 1_000;

    const [[alice, alicePubKey], [bob, bobPubKey, bobPermissionHash]] =
      await twoAgentsOneProgenitorAndOneSteward(
        scenario,
        appSource.appBundleSource,
        ['group'],
        expiry,
      );

    const groupCellBob = getCellByRoleName(bob, 'group');

    // Bob creates another steward permission for nbnoralice
    const input: StewardPermission = {
      for_agent: await fakeAgentPubKey(),
      permission_hash: bobPermissionHash,
    };

    try {
      await groupCellBob.callZome({
        zome_name: 'group',
        fn_name: 'create_steward_permission',
        payload: input,
      });
      fail(
        'Bob should not be able to create a steward permission with having only an expiring steward permission himself',
      );
    } catch (e) {
      if (
        !e
          .toString()
          .includes('Only non-expiring StewardPermissions are allowed to take this action')
      ) {
        fail(
          'Bob should not be able to create a steward permission with having only an expiring steward permission himself',
        );
      }
    }
  });
});

test('Steward can NOT nominate additional stewards without providing a valid permission hash', async () => {
  await runScenario(async (scenario) => {
    // Construct proper paths for your app.
    // This assumes app bundle created by the `hc app pack` command.
    const testAppPath = GROUP_HAPP_PATH;
    // Set up the app to be installed
    const appSource = { appBundleSource: { path: testAppPath } };

    // Expiry is far in the future
    const expiry = (Date.now() + 600_000) * 1_000;

    const [[alice, alicePubKey], [bob, bobPubKey, bobPermissionHash]] =
      await twoAgentsOneProgenitorAndOneSteward(
        scenario,
        appSource.appBundleSource,
        ['group'],
        expiry,
      );

    const groupCellBob = getCellByRoleName(bob, 'group');

    // Bob creates another steward permission for nbnoralice
    const input: StewardPermission = {
      for_agent: await fakeAgentPubKey(),
      permission_hash: null,
    };

    try {
      await groupCellBob.callZome({
        zome_name: 'group',
        fn_name: 'create_steward_permission',
        payload: input,
      });
      fail(
        'Bob should not be able to create a steward permission without providing a valid permission hash',
      );
    } catch (e) {
      if (
        !e.toString().includes('No valid permission hash provided and agent is not the progenitor')
      ) {
        fail(
          'Bob should not be able to create a steward permission with having only an expiring steward permission himself',
        );
      }
    }
  });
});

// TODO
// - test that no steward permission returns member
// - test that Steward permission entries cannot be created for oneself
// - test retrieval of all agents' permission types
