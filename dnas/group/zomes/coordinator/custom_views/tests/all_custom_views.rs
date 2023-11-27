#![allow(dead_code)]
#![allow(unused_variables)]
#![allow(unused_imports)]

use hdk::prelude::*;
use holochain::test_utils::consistency_10s;
use holochain::{conductor::config::ConductorConfig, sweettest::*};

mod common;
use common::{create_custom_view, sample_custom_view_1};

#[tokio::test(flavor = "multi_thread")]
async fn create_a_custom_view_and_get_all_custom_views() {
    // Use prebuilt dna file
    let dna_path = std::env::current_dir()
        .unwrap()
        .join("../../../workdir/group.dna");
    let dna = SweetDnaFile::from_bundle(&dna_path).await.unwrap();

    // Set up conductors
    let mut conductors = SweetConductorBatch::from_config(2, ConductorConfig::default()).await;
    let apps = conductors.setup_app("we", &[dna]).await.unwrap();
    conductors.exchange_peer_info().await;

    let ((alice,), (bobbo,)) = apps.into_tuples();
    
    let alice_zome = alice.zome("custom_views");
    let bob_zome = bobbo.zome("custom_views");
    
    let sample = sample_custom_view_1(&conductors[0], &alice_zome).await;
    
    // Alice creates a CustomView
    let record: Record = create_custom_view(&conductors[0], &alice_zome, sample.clone()).await;
    
    consistency_10s([&alice, &bobbo]).await;
    
    let get_records: Vec<Record> = conductors[1]
        .call(&bob_zome, "get_all_custom_views", ())
        .await;
        
    assert_eq!(get_records.len(), 1);    
    assert_eq!(get_records[0], record);    
}


