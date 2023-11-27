use ::fixt::prelude::fixt;
use std::collections::BTreeMap;

use group_integrity::Applet;
use hdk::prelude::holo_hash::*;
use hdk::prelude::*;
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
        appstore_app_hash: fixt!(ActionHash),

        devhub_dna_hash: fixt!(DnaHash),
        devhub_happ_entry_action_hash: fixt!(ActionHash),
        devhub_happ_release_hash: fixt!(ActionHash),
        initial_devhub_gui_release_hash: Some(fixt!(ActionHash)),

        network_seed: None,
        properties: BTreeMap::new(), // Segmented by RoleId
    };

    let alice_applet_entry_hash: EntryHash = conductors[0]
        .call(&alice_zome, "advertise_group_applet", applet.clone())
        .await;

    consistency_10s([&alice, &bobbo]).await;

    let all_group_applets: Vec<EntryHash> = conductors[1].call(&bob_zome, "get_group_applets", ()).await;

    assert_eq!(all_group_applets.len(), 1);

    // Now Bob stores the joined applet
    let bob_applet_entry_hash: EntryHash = conductors[0]
        .call(&bob_zome, "store_joined_applet", applet)
        .await;

    let bobs_installed_applets: Vec<EntryHash> = conductors[1].call(&bob_zome, "get_my_applets", ()).await;

    assert_eq!(bobs_installed_applets.len(), 1);
    assert_eq!(bobs_installed_applets.first().unwrap().to_owned(), bob_applet_entry_hash);
    assert_eq!(bobs_installed_applets.first().unwrap().to_owned(), alice_applet_entry_hash);


    // Register another applet and make sure unjoined applets returnes the right stuff
    let another_applet = Applet {
        custom_name: String::from("another custom name"),
        description: String::from("another description"),
        appstore_app_hash: fixt!(ActionHash),

        devhub_dna_hash: fixt!(DnaHash),
        devhub_happ_entry_action_hash: fixt!(ActionHash),
        devhub_happ_release_hash: fixt!(ActionHash),
        initial_devhub_gui_release_hash: Some(fixt!(ActionHash)),

        network_seed: None,
        properties: BTreeMap::new(), // Segmented by RoleId
    };

    let alice_another_applet_entry_hash: EntryHash = conductors[0]
        .call(&alice_zome, "advertise_group_applet", another_applet.clone())
        .await;

    consistency_10s([&alice, &bobbo]).await;

    let bobs_unjoined_applets: Vec<(EntryHash, AgentPubKey)> = conductors[1].call(&bob_zome, "get_unjoined_applets", ()).await;

    assert_eq!(bobs_unjoined_applets.len(), 1);
    assert_eq!(bobs_unjoined_applets.first().unwrap().to_owned().0, alice_another_applet_entry_hash);
    assert_eq!(bobs_unjoined_applets.first().unwrap().to_owned().1, alice.agent_pubkey().clone());

}
