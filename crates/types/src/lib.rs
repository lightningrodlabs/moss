use std::collections::BTreeMap;

use hdk::prelude::holo_hash::DnaHash;
use hdk::prelude::*;

/// An applet instance
#[hdk_entry_helper]
#[derive(Clone)]
pub struct Applet {
    // name of the applet as chosen by the person adding it to the group,
    pub custom_name: String,
    pub description: String,

    pub appstore_app_hash: ActionHash,

    pub devhub_dna_hash: DnaHash,
    pub devhub_happ_entry_action_hash: ActionHash,
    pub devhub_happ_release_hash: ActionHash,
    pub initial_devhub_gui_release_hash: Option<ActionHash>, // headless applets are possible as well

    pub network_seed: Option<String>,

    pub properties: BTreeMap<String, SerializedBytes>, // Segmented by RoleName
}

#[hdk_entry_helper]
#[derive(Clone)]
pub struct GroupProfile {
    pub name: String,
    pub logo_src: String,
}
