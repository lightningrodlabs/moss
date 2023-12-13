use std::collections::BTreeMap;

use group_integrity::Applet;
use hdk::prelude::holo_hash::*;
use holochain::test_utils::consistency_10s;
use holochain::{conductor::config::ConductorConfig, sweettest::*};

#[tokio::test(flavor = "multi_thread")]
async fn create_and_join_applet() {
    // Use prebuilt DNA file
    let dna_path = std::env::current_dir()
        .unwrap()
        .join("../../../workdir/group.dna");
    let dna = SweetDnaFile::from_bundle(&dna_path).await.unwrap();

    // Set up conductors
    let mut conductors = SweetConductorBatch::from_config(2, ConductorConfig::default()).await;
    let apps = conductors.setup_app("we", &[dna]).await.unwrap();
    conductors.exchange_peer_info().await;

    let ((alice,), (bobbo,)) = apps.into_tuples();

    let alice_zome = alice.zome("group");
    let bob_zome = bobbo.zome("group");

    let applet = Applet {
        custom_name: String::from("custom name"),
        description: String::from("description"),
        distribution_info: String::from(
            "\"type\": \"appstore-light\",
            \"info\": {
                \"appstoreDnaHash\": \"uhC0kSYZ2EzJD-lfMU7fIGeG0TTaEHfp_MzLynCdKMB1saA-WQGbx\",
                \"appEntryId\": \"uhCkkkI4uY-a8vldReWpwkm-lx8_9yMBj_GW1OELlWqGdQ6_q-msE\",
                \"appEntryActionHash\": \"uhCkkkI4uY-a8vldReWpwkm-lx8_9yMBj_GW1OELlWqGdQ6_q-msE\",
                \"appEntryEntryHash\": \"uhCEkOOnoE0PguBRCH7R7hTFOKfpMGuZ9WOY0z3BhyIUXy736QBmf\"
        }",
        ),
        sha256_happ: String::from(
            "bfc88f5cf93485146b7175eacb7df0bac42b2ec9455c76bb4c4b4f8c0ccb3db4",
        ),
        sha256_ui: Some(String::from(
            "d87af80f42ad547aae7e38545ccc7e5e0fe5c618326ede42dddb33430c12da1f",
        )),
        sha256_webhapp: Some(String::from(
            "e15e296e0df775222065cef4f476f66fcf6f681a07d40e4795fc5ae2f28c58bd",
        )),
        network_seed: None,
        properties: BTreeMap::new(), // Segmented by RoleId
        meta_data: None,
    };

    let alice_applet_entry_hash: EntryHash = conductors[0]
        .call(&alice_zome, "advertise_group_applet", applet.clone())
        .await;

    consistency_10s([&alice, &bobbo]).await;

    let all_group_applets: Vec<EntryHash> =
        conductors[1].call(&bob_zome, "get_group_applets", ()).await;

    assert_eq!(all_group_applets.len(), 1);

    // Now Bob stores the joined applet
    let bob_applet_entry_hash: EntryHash = conductors[0]
        .call(&bob_zome, "store_joined_applet", applet)
        .await;

    let bobs_installed_applets: Vec<EntryHash> =
        conductors[1].call(&bob_zome, "get_my_applets", ()).await;

    assert_eq!(bobs_installed_applets.len(), 1);
    assert_eq!(
        bobs_installed_applets.first().unwrap().to_owned(),
        bob_applet_entry_hash
    );
    assert_eq!(
        bobs_installed_applets.first().unwrap().to_owned(),
        alice_applet_entry_hash
    );

    // Register another applet and make sure unjoined applets returnes the right stuff
    let another_applet = Applet {
        custom_name: String::from("another custom name"),
        description: String::from("another description"),
        distribution_info: String::from(
            "\"type\": \"appstore-light\",
            \"info\": {
                \"appstoreDnaHash\": \"uhC0kSYZ2EzJD-lfMU7fIGeG0TTaEHfp_MzLynCdKMB1saA-WQGbx\",
                \"appEntryId\": \"uhCkkkI4uY-a8vldReWpwkm-lx8_9yMBj_GW1OELlWqGdQ6_q-msE\",
                \"appEntryActionHash\": \"uhCkkkI4uY-a8vldReWpwkm-lx8_9yMBj_GW1OELlWqGdQ6_q-msE\",
                \"appEntryEntryHash\": \"uhCEkOOnoE0PguBRCH7R7hTFOKfpMGuZ9WOY0z3BhyIUXy736QBmf\"
        }",
        ),
        sha256_happ: String::from(
            "bfc88f5cf93485146b7175eacb7df0bac42b2ec9455c76bb4c4b4f8c0ccb3db4",
        ),
        sha256_ui: Some(String::from(
            "d87af80f42ad547aae7e38545ccc7e5e0fe5c618326ede42dddb33430c12da1f",
        )),
        sha256_webhapp: Some(String::from(
            "e15e296e0df775222065cef4f476f66fcf6f681a07d40e4795fc5ae2f28c58bd",
        )),
        network_seed: None,
        properties: BTreeMap::new(), // Segmented by RoleId
        meta_data: None,
    };

    let alice_another_applet_entry_hash: EntryHash = conductors[0]
        .call(
            &alice_zome,
            "advertise_group_applet",
            another_applet.clone(),
        )
        .await;

    consistency_10s([&alice, &bobbo]).await;

    let bobs_unjoined_applets: Vec<(EntryHash, AgentPubKey)> = conductors[1]
        .call(&bob_zome, "get_unjoined_applets", ())
        .await;

    assert_eq!(bobs_unjoined_applets.len(), 1);
    assert_eq!(
        bobs_unjoined_applets.first().unwrap().to_owned().0,
        alice_another_applet_entry_hash
    );
    assert_eq!(
        bobs_unjoined_applets.first().unwrap().to_owned().1,
        alice.agent_pubkey().clone()
    );
}
