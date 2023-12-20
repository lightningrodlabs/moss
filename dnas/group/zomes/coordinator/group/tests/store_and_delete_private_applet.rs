// use std::collections::BTreeMap;

// use group_integrity::Applet;
// use hdk::prelude::holo_hash::*;
// use hdk::prelude::*;

// use holochain::{conductor::config::ConductorConfig, sweettest::*};

// #[tokio::test(flavor = "multi_thread")]
// async fn store_and_delete_private_applet_entry() {
//     // Use prebuilt DNA file
//     let dna_path = std::env::current_dir()
//         .unwrap()
//         .join("../../../workdir/group.dna");
//     let dna = SweetDnaFile::from_bundle(&dna_path).await.unwrap();

//     // Set up conductors
//     let mut conductor = SweetConductor::from_config(ConductorConfig::default()).await;
//     let app = conductor.setup_app("we", &[dna]).await.unwrap();

//     let (cell,) = app.into_tuple();

//     let group_zome = cell.zome("group");

//     let applet = Applet {
//         custom_name: String::from("custom name"),
//         description: String::from("description"),
//         distribution_info: String::from(
//             "\"type\": \"appstore-light\",
//             \"info\": {
//                 \"appstoreDnaHash\": \"uhC0kSYZ2EzJD-lfMU7fIGeG0TTaEHfp_MzLynCdKMB1saA-WQGbx\",
//                 \"appEntryId\": \"uhCkkkI4uY-a8vldReWpwkm-lx8_9yMBj_GW1OELlWqGdQ6_q-msE\",
//                 \"appEntryActionHash\": \"uhCkkkI4uY-a8vldReWpwkm-lx8_9yMBj_GW1OELlWqGdQ6_q-msE\",
//                 \"appEntryEntryHash\": \"uhCEkOOnoE0PguBRCH7R7hTFOKfpMGuZ9WOY0z3BhyIUXy736QBmf\"
//         }",
//         ),
//         sha256_happ: String::from(
//             "bfc88f5cf93485146b7175eacb7df0bac42b2ec9455c76bb4c4b4f8c0ccb3db4",
//         ),
//         sha256_ui: Some(String::from(
//             "d87af80f42ad547aae7e38545ccc7e5e0fe5c618326ede42dddb33430c12da1f",
//         )),
//         sha256_webhapp: Some(String::from(
//             "e15e296e0df775222065cef4f476f66fcf6f681a07d40e4795fc5ae2f28c58bd",
//         )),
//         network_seed: None,
//         properties: BTreeMap::new(), // Segmented by RoleId
//         meta_data: None,
//     };

//     let private_applet_record: Record = conductor
//         .call(&group_zome, "store_joined_applet", applet.clone())
//         .await;

//     let all_my_applets: Vec<Record> = conductor.call(&group_zome, "get_my_applets", ()).await;

//     assert_eq!(all_my_applets.len(), 1);
//     assert_eq!(
//         all_my_applets.first().unwrap().to_owned(),
//         private_applet_record
//     );

//     let _delete_action: ActionHash = conductor
//         .call(
//             &group_zome,
//             "delete_joined_applet",
//             private_applet_record.action_address(),
//         )
//         .await;

//     let my_remaining_applets: Vec<Record> = conductor.call(&group_zome, "get_my_applets", ()).await;
//     assert_eq!(my_remaining_applets.len(), 0);
// }
