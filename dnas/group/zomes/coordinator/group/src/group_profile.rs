use group_integrity::*;
use hdk::prelude::*;

use crate::get_latest_record_from_links;
#[hdk_extern]
pub fn set_group_profile(group_profile: GroupProfile) -> ExternResult<Record> {
    let group_profile_hash = create_entry(&EntryTypes::GroupProfile(group_profile.clone()))?;
    let record = get(group_profile_hash.clone(), GetOptions::default())?.ok_or(wasm_error!(
        WasmErrorInner::Guest("Could not find the newly created GroupProfile".to_string())
    ))?;
    let path = Path::from("all_group_profiles");
    create_link(
        path.path_entry_hash()?,
        group_profile_hash.clone(),
        LinkTypes::AllGroupProfiles,
        (),
    )?;
    Ok(record)
}

#[hdk_extern]
pub fn get_group_profile() -> ExternResult<Option<Record>> {
    let path = Path::from("all_group_profiles");
    let links = get_links(
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AllGroupProfiles)?
            .build(),
    )?;
    get_latest_record_from_links(links)
}
