use group_integrity::*;
use hdk::prelude::*;
#[hdk_extern]
pub fn set_group_meta_data(group_meta_data: GroupMetaData) -> ExternResult<Record> {
    let group_meta_data_hash = create_entry(&EntryTypes::GroupMetaData(group_meta_data.clone()))?;
    let record = get(group_meta_data_hash.clone(), GetOptions::default())?.ok_or(wasm_error!(
        WasmErrorInner::Guest("Could not find the newly created GroupProfile".to_string())
    ))?;
    let path = Path::from(group_meta_data.name.as_str());
    create_link(
        path.path_entry_hash()?,
        group_meta_data_hash.clone(),
        LinkTypes::GroupMetaDataToAnchor,
        (),
    )?;
    Ok(record)
}

#[hdk_extern]
pub fn get_group_meta_data(name: String) -> ExternResult<Option<Record>> {
    let path = Path::from(name.as_str());

    let links = get_links(
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::GroupMetaDataToAnchor)?
            .build(),
    )?;

    let latest_group_meta_data_link = links
        .into_iter()
        .max_by(|link_a, link_b| link_a.timestamp.cmp(&link_b.timestamp));

    // This might be brittle in case the link has propagated but not yet the entry
    match latest_group_meta_data_link {
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
