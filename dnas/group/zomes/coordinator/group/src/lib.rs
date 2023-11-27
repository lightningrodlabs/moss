use group_integrity::*;
use hdk::prelude::*;

pub mod applets;
pub mod related_groups;

pub fn group_info_path() -> ExternResult<TypedPath> {
    Path::from("group_profile").typed(LinkTypes::GroupInfoPath)
}

// If this function returns None, it means that we haven't synced up yet
#[hdk_extern]
pub fn get_group_profile(_: ()) -> ExternResult<Option<Record>> {
    let path = group_info_path()?;

    let links = get_links(
        path.path_entry_hash()?,
        LinkTypes::AnchorToGroupProfile,
        None,
    )?;

    let latest_group_info_link = links
        .into_iter()
        .max_by(|link_a, link_b| link_b.timestamp.cmp(&link_a.timestamp));

    match latest_group_info_link {
        None => Ok(None),
        Some(link) => {
            let record = get(
                // ActionHash::from(link.target),
                ActionHash::try_from(link.target)
                    .map_err(|e| wasm_error!(WasmErrorInner::from(e)))?,
                GetOptions::default(),
            )?;

            Ok(record)
        }
    }
}

#[hdk_extern]
pub fn set_group_profile(group_profile: GroupProfile) -> ExternResult<()> {
    let path = group_info_path()?;

    let action_hash = create_entry(EntryTypes::GroupProfile(group_profile))?;

    create_link(
        path.path_entry_hash()?,
        action_hash,
        LinkTypes::AnchorToGroupProfile,
        (),
    )?;

    Ok(())
}
