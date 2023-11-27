use group_integrity::*;
use hdk::prelude::*;

pub fn related_groups_path() -> Path {
    Path::from("related_groups")
}

// If this function returns None, it means that we haven't synced up yet
#[hdk_extern]
pub fn get_related_groups(_: ()) -> ExternResult<Vec<Record>> {
    let path = related_groups_path();

    let links = get_links(
        path.path_entry_hash()?,
        LinkTypes::AnchorToRelatedGroup,
        None,
    )?;

    let get_input: Vec<GetInput> = links
        .into_iter()
        .filter_map(|link| link.target.into_entry_hash())
        .map(|entry_hash| GetInput::new(entry_hash.into(), GetOptions::default()))
        .collect();
    let records = HDK.with(|hdk| hdk.borrow().get(get_input))?;
    let records: Vec<Record> = records.into_iter().filter_map(|r| r).collect();
    Ok(records)
}

#[hdk_extern]
pub fn add_related_group(related_group: RelatedGroup) -> ExternResult<()> {
    let path = related_groups_path();

    let related_group_hash = hash_entry(&related_group)?;

    create_entry(EntryTypes::RelatedGroup(related_group))?;

    create_link(
        path.path_entry_hash()?,
        related_group_hash,
        LinkTypes::AnchorToRelatedGroup,
        (),
    )?;

    Ok(())
}
