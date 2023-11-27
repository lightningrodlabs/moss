#![allow(dead_code)]
#![allow(unused_variables)]
#![allow(unused_imports)]

use hdk::prelude::*;
use holochain::test_utils::consistency_10s;
use holochain::{conductor::config::ConductorConfig, sweettest::*};

use custom_views_integrity::*;

use custom_views::custom_view::UpdateCustomViewInput;

mod common;
use common::{create_custom_view, sample_custom_view_1, sample_custom_view_2};


#[tokio::test(flavor = "multi_thread")]
async fn create_custom_view_test() {
    // Use prebuilt dna file
    let dna_path = std::env::current_dir()
        .unwrap()
        .join("../../../workdir/group.dna");
    let dna = SweetDnaFile::from_bundle(&dna_path).await.unwrap();

    // Set up conductors
    let mut conductors = SweetConductorBatch::from_config(2, ConductorConfig::default()).await;
    let apps = conductors.setup_app("we", &[dna]).await.unwrap();
    conductors.exchange_peer_info().await;

    let ((alice,), (_bobbo,)) = apps.into_tuples();
    
    let alice_zome = alice.zome("custom_views");
    
    let sample = sample_custom_view_1(&conductors[0], &alice_zome).await;
    
    // Alice creates a CustomView
    let record: Record = create_custom_view(&conductors[0], &alice_zome, sample.clone()).await;
    let entry: CustomView = record.entry().to_app_option().unwrap().unwrap();
    assert!(entry.eq(&sample));
}


#[tokio::test(flavor = "multi_thread")]
async fn create_and_read_custom_view() {
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
    
    let get_record: Option<Record> = conductors[1]
        .call(&bob_zome, "get_custom_view", record.signed_action.action_address().clone())
        .await;
        
    assert_eq!(record, get_record.unwrap());    
}

#[tokio::test(flavor = "multi_thread")]
async fn create_and_update_custom_view() {
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
    
    let sample_1 = sample_custom_view_1(&conductors[0], &alice_zome).await;
    
    // Alice creates a CustomView
    let record: Record = create_custom_view(&conductors[0], &alice_zome, sample_1.clone()).await;
    let original_action_hash = record.signed_action.hashed.hash.clone();
        
    consistency_10s([&alice, &bobbo]).await;
    
    let sample_2 = sample_custom_view_2(&conductors[0], &alice_zome).await;
    let input = UpdateCustomViewInput {
      previous_custom_view_hash: original_action_hash.clone(),
      updated_custom_view: sample_2.clone(),
    };
    
    // Alice updates the CustomView
    let update_record: Record = conductors[0]
        .call(&alice_zome, "update_custom_view", input)
        .await;
        
    let entry: CustomView = update_record.entry().to_app_option().unwrap().unwrap();
    assert_eq!(sample_2, entry);
    
    consistency_10s([&alice, &bobbo]).await;
    
    let get_record: Option<Record> = conductors[1]
        .call(&bob_zome, "get_custom_view", original_action_hash.clone())
        .await;
  
    assert_eq!(update_record, get_record.unwrap());
    
    let input = UpdateCustomViewInput {
      previous_custom_view_hash: update_record.signed_action.hashed.hash.clone(),
      updated_custom_view: sample_1.clone(),
    };
    
    // Alice updates the CustomView again
    let update_record: Record = conductors[0]
        .call(&alice_zome, "update_custom_view", input)
        .await;
        
    let entry: CustomView = update_record.entry().to_app_option().unwrap().unwrap();
    assert_eq!(sample_1, entry);
    
    consistency_10s([&alice, &bobbo]).await;
    
    let get_record: Option<Record> = conductors[1]
        .call(&bob_zome, "get_custom_view", original_action_hash.clone())
        .await;
  
    assert_eq!(update_record, get_record.unwrap());
}

#[tokio::test(flavor = "multi_thread")]
async fn create_and_delete_custom_view() {
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
    
    let sample_1 = sample_custom_view_1(&conductors[0], &alice_zome).await;
    
    // Alice creates a CustomView
    let record: Record = create_custom_view(&conductors[0], &alice_zome, sample_1.clone()).await;
    let original_action_hash = record.signed_action.hashed.hash;
    
    // Alice deletes the CustomView
    let _delete_action_hash: ActionHash = conductors[0]
        .call(&alice_zome, "delete_custom_view", original_action_hash.clone())
        .await;

    consistency_10s([&alice, &bobbo]).await;

    let get_record: Option<Record> = conductors[1]
        .call(&bob_zome, "get_custom_view", original_action_hash.clone())
        .await;
        
    assert!(get_record.is_none());
}
