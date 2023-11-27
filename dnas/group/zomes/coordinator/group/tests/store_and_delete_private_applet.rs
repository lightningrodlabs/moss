use ::fixt::prelude::fixt;
use std::collections::BTreeMap;

use group_integrity::Applet;
use hdk::prelude::holo_hash::*;
use hdk::prelude::*;

use holochain::{conductor::config::ConductorConfig, sweettest::*};

#[tokio::test(flavor = "multi_thread")]
async fn store_and_delete_private_applet_entry() {
    // Use prebuilt DNA file
    let dna_path = std::env::current_dir()
        .unwrap()
        .join("../../../workdir/group.dna");
    let dna = SweetDnaFile::from_bundle(&dna_path).await.unwrap();

    // Set up conductors
    let mut conductor = SweetConductor::from_config(ConductorConfig::default()).await;
    let app = conductor.setup_app("we", &[dna]).await.unwrap();

    let (cell,) = app.into_tuple();

    let group_zome = cell.zome("group");

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

    let private_applet_record: Record = conductor
        .call(&group_zome, "store_joined_applet", applet.clone())
        .await;

    let all_my_applets: Vec<Record> = conductor.call(&group_zome, "get_my_applets", ()).await;

    assert_eq!(all_my_applets.len(), 1);
    assert_eq!(
        all_my_applets.first().unwrap().to_owned(),
        private_applet_record
    );

    let _delete_action: ActionHash = conductor
        .call(
            &group_zome,
            "delete_joined_applet",
            private_applet_record.action_address(),
        )
        .await;

    let my_remaining_applets: Vec<Record> = conductor.call(&group_zome, "get_my_applets", ()).await;
    assert_eq!(my_remaining_applets.len(), 0);
}
