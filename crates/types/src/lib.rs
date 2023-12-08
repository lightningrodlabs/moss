use hdk::prelude::*;
use std::collections::BTreeMap;

/// An applet instance
#[hdk_entry_helper]
#[derive(Clone)]
pub struct Applet {
    // name of the applet as chosen by the person adding it to the group,
    pub custom_name: String,
    pub description: String,
    pub appstore_app_hash: ActionHash,
    pub network_seed: Option<String>,
    pub properties: BTreeMap<String, SerializedBytes>, // Segmented by RoleName
}

#[hdk_entry_helper]
#[derive(Clone)]
pub struct GroupProfile {
    pub name: String,
    pub logo_src: String,
}
