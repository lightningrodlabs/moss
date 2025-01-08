import { assert, test } from 'vitest';
import { encode } from '@msgpack/msgpack';
import { runScenario, dhtSync } from '@holochain/tryorama';
import { encodeHashToBase64, EntryHash, fakeActionHash } from '@holochain/client';
import { WAL } from '@theweave/api';

import { getCellByRoleName, GROUP_HAPP_PATH } from '../../shared.js';
import {
  AssetRelation,
  AssetRelationAndHash,
  AssetRelationWithTags,
  RelateAssetsInput,
  RemoveTagsFromAssetRelationInput,
} from '@theweave/group-client';

test('Add an asset relation, remove it again and try to get it from the ALL_ASSET_RELATIONS_ANCHOR', async () => {
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

    // 1. Alice adds two asset relations between two WALs, then both Alice and Bob try to read it
    const wal1: WAL = {
      hrl: [assetsCellAlice.cell_id[0], await fakeActionHash()],
      context: new Uint8Array(4),
    };

    const wal2: WAL = {
      hrl: [assetsCellAlice.cell_id[0], await fakeActionHash()],
      context: new Uint8Array(5),
    };

    const input1: RelateAssetsInput = {
      src_wal: wal1,
      dst_wal: wal2,
      tags: ['depends_on', 'loves', 'cares_about'],
    };

    const assetRelation1: AssetRelationWithTags = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'add_asset_relation',
      payload: input1,
    });

    await dhtSync([alice, bob], assetsCellAlice.cell_id[0]);

    // Bob tries to get it from the anchor
    const allAssetRelations: AssetRelationAndHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_all_asset_relations',
      payload: null,
    });

    assert(allAssetRelations.length === 1);
    assert.deepEqual(allAssetRelations[0], {
      src_wal: assetRelation1.src_wal,
      dst_wal: assetRelation1.dst_wal,
      relation_hash: assetRelation1.relation_hash,
      created_at: assetRelation1.created_at,
    });

    const allAssetRelationHashes: EntryHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_all_asset_relation_hashes',
      payload: null,
    });

    assert(allAssetRelationHashes.length === 1);
    assert(
      encodeHashToBase64(assetRelation1.relation_hash),
      encodeHashToBase64(allAssetRelationHashes[0]),
    );

    const assetRelation2: AssetRelation | undefined = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_asset_relation_by_hash',
      payload: assetRelation1.relation_hash,
    });

    assert(!!assetRelation2);
    assert.deepEqual(assetRelation2.src_wal.hrl, wal1.hrl);
    assert.deepEqual(assetRelation2.dst_wal.hrl, wal2.hrl);

    //- Remove the AssetRelation and check that it is not discoverable anymore

    await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'remove_asset_relation',
      payload: assetRelation1.relation_hash,
    });

    await dhtSync([alice, bob], assetsCellAlice.cell_id[0]);

    const allAssetRelationsAlice: AssetRelationAndHash[] = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'get_all_asset_relations',
      payload: null,
    });

    assert(allAssetRelationsAlice.length === 0);

    const allAssetRelationHashesAlice: EntryHash[] = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'get_all_asset_relation_hashes',
      payload: null,
    });

    assert(allAssetRelationHashesAlice.length === 0);
  });
});

test('Add two asset relations between 3 WALs and read them', async () => {
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

    // 1. Alice adds two asset relations between two WALs, then both Alice and Bob try to read it
    const wal1: WAL = {
      hrl: [assetsCellAlice.cell_id[0], await fakeActionHash()],
      context: new Uint8Array(4),
    };

    const wal2: WAL = {
      hrl: [assetsCellAlice.cell_id[0], await fakeActionHash()],
      context: new Uint8Array(5),
    };

    const wal3: WAL = {
      hrl: [assetsCellAlice.cell_id[0], await fakeActionHash()],
      context: new Uint8Array(6),
    };

    const input1: RelateAssetsInput = {
      src_wal: wal1,
      dst_wal: wal2,
      tags: ['depends_on', 'loves', 'cares_about'],
    };

    const assetRelation1: AssetRelationWithTags = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'add_asset_relation',
      payload: input1,
    });

    const input2: RelateAssetsInput = {
      src_wal: wal1,
      dst_wal: wal3,
      tags: ['is_about'],
    };

    const assetRelation2: AssetRelationWithTags = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'add_asset_relation',
      payload: input2,
    });

    // Alice tries to read them

    // Read outgoing asset relations from wal 1
    const outgoingRelationsWal1ReadByAlice: AssetRelationAndHash[] = await assetsCellAlice.callZome(
      {
        zome_name: 'assets',
        fn_name: 'get_outgoing_asset_relations',
        payload: wal1,
      },
    );

    const wal1RelationReadByAlice = outgoingRelationsWal1ReadByAlice.find(
      (rel) =>
        encodeHashToBase64(rel.relation_hash) === encodeHashToBase64(assetRelation1.relation_hash),
    );
    assert.deepEqual(wal1RelationReadByAlice, {
      src_wal: assetRelation1.src_wal,
      dst_wal: assetRelation1.dst_wal,
      relation_hash: assetRelation1.relation_hash,
      created_at: assetRelation1.created_at,
    });

    const wal2RelationReadByAlice = outgoingRelationsWal1ReadByAlice.find(
      (rel) =>
        encodeHashToBase64(rel.relation_hash) === encodeHashToBase64(assetRelation2.relation_hash),
    );

    assert.deepEqual(wal2RelationReadByAlice, {
      src_wal: assetRelation2.src_wal,
      dst_wal: assetRelation2.dst_wal,
      relation_hash: assetRelation2.relation_hash,
      created_at: assetRelation2.created_at,
    });

    // Read incoming asset relations for wal2 and wal3
    const incomingRelationsWal2ReadByAlice: AssetRelationAndHash[] = await assetsCellAlice.callZome(
      {
        zome_name: 'assets',
        fn_name: 'get_incoming_asset_relations',
        payload: wal2,
      },
    );

    assert(incomingRelationsWal2ReadByAlice.length === 1);
    assert.deepEqual(incomingRelationsWal2ReadByAlice[0], {
      src_wal: assetRelation1.src_wal,
      dst_wal: assetRelation1.dst_wal,
      relation_hash: assetRelation1.relation_hash,
      created_at: assetRelation1.created_at,
    });

    const incomingRelationsWal3ReadByAlice: AssetRelationAndHash[] = await assetsCellAlice.callZome(
      {
        zome_name: 'assets',
        fn_name: 'get_incoming_asset_relations',
        payload: wal3,
      },
    );

    assert(incomingRelationsWal3ReadByAlice.length === 1);
    assert.deepEqual(incomingRelationsWal3ReadByAlice[0], {
      src_wal: assetRelation2.src_wal,
      dst_wal: assetRelation2.dst_wal,
      relation_hash: assetRelation2.relation_hash,
      created_at: assetRelation2.created_at,
    });

    await dhtSync([alice, bob], assetsCellAlice.cell_id[0]);

    // Bob tries to read them
    const outgoingRelationsReadByBob: AssetRelationAndHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_outgoing_asset_relations',
      payload: wal1,
    });

    const wal1RelationReadByBob = outgoingRelationsReadByBob.find(
      (rel) =>
        encodeHashToBase64(rel.relation_hash) === encodeHashToBase64(assetRelation1.relation_hash),
    );
    assert.deepEqual(wal1RelationReadByBob, {
      src_wal: assetRelation1.src_wal,
      dst_wal: assetRelation1.dst_wal,
      relation_hash: assetRelation1.relation_hash,
      created_at: assetRelation1.created_at,
    });

    const wal2RelationReadByBob = outgoingRelationsReadByBob.find(
      (rel) =>
        encodeHashToBase64(rel.relation_hash) === encodeHashToBase64(assetRelation2.relation_hash),
    );

    assert.deepEqual(wal2RelationReadByBob, {
      src_wal: assetRelation2.src_wal,
      dst_wal: assetRelation2.dst_wal,
      relation_hash: assetRelation2.relation_hash,
      created_at: assetRelation2.created_at,
    });

    // Read incoming asset relations for wal2 and wal3
    const incomingRelationsWal2ReadByBob: AssetRelationAndHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_incoming_asset_relations',
      payload: wal2,
    });

    assert(incomingRelationsWal2ReadByBob.length === 1);
    assert.deepEqual(incomingRelationsWal2ReadByBob[0], {
      src_wal: assetRelation1.src_wal,
      dst_wal: assetRelation1.dst_wal,
      relation_hash: assetRelation1.relation_hash,
      created_at: assetRelation1.created_at,
    });

    const incomingRelationsWal3ReadByBob: AssetRelationAndHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_incoming_asset_relations',
      payload: wal3,
    });

    assert(incomingRelationsWal3ReadByBob.length === 1);
    assert.deepEqual(incomingRelationsWal3ReadByBob[0], {
      src_wal: assetRelation2.src_wal,
      dst_wal: assetRelation2.dst_wal,
      relation_hash: assetRelation2.relation_hash,
      created_at: assetRelation2.created_at,
    });
  });
});

test('Add an asset relation between 2 WALs, then read and modify it', async () => {
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

    // 1. Alice adds two asset relations between two WALs, then both Alice and Bob try to read it
    const wal1: WAL = {
      hrl: [assetsCellAlice.cell_id[0], Buffer.from(await fakeActionHash())],
      context: new Uint8Array(4),
    };

    const wal2: WAL = {
      hrl: [assetsCellAlice.cell_id[0], Buffer.from(await fakeActionHash())],
      context: new Uint8Array(5),
    };

    const input1: RelateAssetsInput = {
      src_wal: wal1,
      dst_wal: wal2,
      tags: ['depends_on', 'loves', 'cares_about', 'likes'],
    };

    const assetRelation1: AssetRelationWithTags = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'add_asset_relation',
      payload: input1,
    });

    // Bob tries to read the relation
    await dhtSync([alice, bob], assetsCellAlice.cell_id[0]);

    // Read outgoing asset relations from wal 1
    const outgoingRelationsWal1ReadByBob: AssetRelationWithTags[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_outgoing_asset_relations_with_tags',
      payload: wal1,
    });

    assert(outgoingRelationsWal1ReadByBob.length === 1);
    const rel = outgoingRelationsWal1ReadByBob[0];
    assert(
      rel.tags.includes('depends_on') &&
        rel.tags.includes('loves') &&
        rel.tags.includes('cares_about') &&
        rel.tags.includes('likes'),
    );
    assert.deepEqual(input1.src_wal.hrl, rel.src_wal.hrl);
    assert.deepEqual(Uint8Array.from(input1.src_wal.context), Uint8Array.from(rel.src_wal.context));
    assert.deepEqual(input1.dst_wal.hrl, rel.dst_wal.hrl);
    assert.deepEqual(Uint8Array.from(input1.dst_wal.context), Uint8Array.from(rel.dst_wal.context));

    // Bob removes some tags and Alice should not see these tags anymore
    const input: RemoveTagsFromAssetRelationInput = {
      relation_hash: rel.relation_hash,
      tags: ['depends_on', 'loves'],
    };
    await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'remove_tags_from_asset_relation',
      payload: input,
    });

    await dhtSync([alice, bob], assetsCellAlice.cell_id[0]);

    const outgoingRelationsWal1ReadByAlice: AssetRelationWithTags[] =
      await assetsCellAlice.callZome({
        zome_name: 'assets',
        fn_name: 'get_outgoing_asset_relations_with_tags',
        payload: wal1,
      });

    assert(outgoingRelationsWal1ReadByAlice.length === 1);
    const relModified = outgoingRelationsWal1ReadByAlice[0];
    assert(
      !relModified.tags.includes('depends_on') &&
        !relModified.tags.includes('loves') &&
        relModified.tags.includes('cares_about') &&
        relModified.tags.includes('likes'),
    );
    assert.deepEqual(input1.src_wal.hrl, relModified.src_wal.hrl);
    assert.deepEqual(
      Uint8Array.from(input1.src_wal.context),
      Uint8Array.from(relModified.src_wal.context),
    );
    assert.deepEqual(input1.dst_wal.hrl, relModified.dst_wal.hrl);
    assert.deepEqual(
      Uint8Array.from(input1.dst_wal.context),
      Uint8Array.from(relModified.dst_wal.context),
    );

    // Check that Alice sees the relationship linked to the still existing tag but not the removed ones
    const assetRelationsLinkedToTag1: AssetRelationAndHash[] = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'get_asset_relations_for_relationship_tag',
      payload: 'depends_on',
    });
    assert(assetRelationsLinkedToTag1.length === 0);

    const assetRelationsLinkedToTag2: AssetRelationAndHash[] = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'get_asset_relations_for_relationship_tag',
      payload: 'loves',
    });
    assert(assetRelationsLinkedToTag2.length === 0);

    const assetRelationsLinkedToTag3: AssetRelationAndHash[] = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'get_asset_relations_for_relationship_tag',
      payload: 'cares_about',
    });
    assert(assetRelationsLinkedToTag3.length === 1);
    assert.deepEqual(input1.src_wal.hrl, assetRelationsLinkedToTag3[0].src_wal.hrl);
    assert.deepEqual(
      Uint8Array.from(input1.src_wal.context),
      Uint8Array.from(assetRelationsLinkedToTag3[0].src_wal.context),
    );
    assert.deepEqual(input1.dst_wal.hrl, assetRelationsLinkedToTag3[0].dst_wal.hrl);
    assert.deepEqual(
      Uint8Array.from(input1.dst_wal.context),
      Uint8Array.from(assetRelationsLinkedToTag3[0].dst_wal.context),
    );

    const assetRelationsLinkedToTag4: AssetRelationAndHash[] = await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'get_asset_relations_for_relationship_tag',
      payload: 'likes',
    });
    assert(assetRelationsLinkedToTag4.length === 1);
    assert.deepEqual(input1.src_wal.hrl, assetRelationsLinkedToTag4[0].src_wal.hrl);
    assert.deepEqual(
      Uint8Array.from(input1.src_wal.context),
      Uint8Array.from(assetRelationsLinkedToTag4[0].src_wal.context),
    );
    assert.deepEqual(input1.dst_wal.hrl, assetRelationsLinkedToTag4[0].dst_wal.hrl);
    assert.deepEqual(
      Uint8Array.from(input1.dst_wal.context),
      Uint8Array.from(assetRelationsLinkedToTag4[0].dst_wal.context),
    );

    // Remove the asset relation alltogether and verify that nothing is returned anymore.
    await assetsCellAlice.callZome({
      zome_name: 'assets',
      fn_name: 'remove_asset_relation',
      payload: assetRelation1.relation_hash,
    });

    await dhtSync([alice, bob], assetsCellAlice.cell_id[0]);

    const assetRelationsLinkedToTag1Bob: AssetRelationAndHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_asset_relations_for_relationship_tag',
      payload: 'depends_on',
    });
    assert(assetRelationsLinkedToTag1Bob.length === 0);

    const assetRelationsLinkedToTag2Bob: AssetRelationAndHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_asset_relations_for_relationship_tag',
      payload: 'loves',
    });
    assert(assetRelationsLinkedToTag2Bob.length === 0);

    const assetRelationsLinkedToTag3Bob: AssetRelationAndHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_asset_relations_for_relationship_tag',
      payload: 'cares_about',
    });
    assert(assetRelationsLinkedToTag3Bob.length === 0);

    const assetRelationsLinkedToTag4Bob: AssetRelationAndHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_asset_relations_for_relationship_tag',
      payload: 'likes',
    });
    assert(assetRelationsLinkedToTag4Bob.length === 0);

    const outgoingRelationsWithTagsWal1ReadByBob2: AssetRelationWithTags[] =
      await assetsCellBob.callZome({
        zome_name: 'assets',
        fn_name: 'get_outgoing_asset_relations_with_tags',
        payload: wal1,
      });
    assert(outgoingRelationsWithTagsWal1ReadByBob2.length === 0);

    const incomingRelationsWithTagsWal2ReadByBob2: AssetRelationWithTags[] =
      await assetsCellBob.callZome({
        zome_name: 'assets',
        fn_name: 'get_incoming_asset_relations_with_tags',
        payload: wal2,
      });
    assert(incomingRelationsWithTagsWal2ReadByBob2.length === 0);

    const outgoingRelationsWal1ReadByBob2: AssetRelationAndHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_outgoing_asset_relations',
      payload: wal1,
    });
    assert(outgoingRelationsWal1ReadByBob2.length === 0);

    const incomingRelationsWal2ReadByBob2: AssetRelationAndHash[] = await assetsCellBob.callZome({
      zome_name: 'assets',
      fn_name: 'get_incoming_asset_relations',
      payload: wal2,
    });
    assert(incomingRelationsWal2ReadByBob2.length === 0);
  });
});
