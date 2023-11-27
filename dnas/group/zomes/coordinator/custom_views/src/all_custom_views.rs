use custom_views_integrity::*;
use hdk::prelude::*;
#[hdk_extern]
pub fn get_all_custom_views(_: ()) -> ExternResult<Vec<Record>> {
    let path = Path::from("all_custom_views");
    let links = get_links(path.path_entry_hash()?, LinkTypes::AllCustomViews, None)?;
    let get_input: Vec<GetInput> = links
        .into_iter()
        .filter_map(|link| link.target.into_action_hash())
        .map(|action_hash| GetInput::new(action_hash.into(), GetOptions::default()))
        .collect();
    let records = HDK.with(|hdk| hdk.borrow().get(get_input))?;
    let records: Vec<Record> = records.into_iter().filter_map(|r| r).collect();
    Ok(records)
}
