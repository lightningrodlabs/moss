use hdk::prelude::*;
use holochain::sweettest::*;

use custom_views_integrity::*;



pub async fn sample_custom_view_1(conductor: &SweetConductor, zome: &SweetZome) -> CustomView {
    CustomView {
      name: String::from("Custom view 1"),
      logo: String::from(""),
	  html: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.".to_string(),
	  js: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.".to_string(),
	  css: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.".to_string(),
    }
}

pub async fn sample_custom_view_2(conductor: &SweetConductor, zome: &SweetZome) -> CustomView {
    CustomView {
      name: String::from("Custom view 1"),
      logo: String::from(""),
	  html: "Lorem ipsum 2".to_string(),
	  js: "Lorem ipsum 2".to_string(),
	  css: "Lorem ipsum 2".to_string(),
    }
}

pub async fn create_custom_view(conductor: &SweetConductor, zome: &SweetZome, custom_view: CustomView) -> Record {
    let record: Record = conductor
        .call(zome, "create_custom_view", custom_view)
        .await;
    record
}

