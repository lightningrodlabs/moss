use foyer_integrity::*;
use hdk::prelude::*;
use moss_helpers::ZomeFnInput;

#[hdk_extern]
pub fn create_thing(thing: Thing) -> ExternResult<Record> {
    let thing_hash = create_entry(&EntryTypes::Thing(thing.clone()))?;
    let record = get(thing_hash.clone(), GetOptions::local())?.ok_or(wasm_error!(
        WasmErrorInner::Guest(String::from("Could not find the newly created Thing"))
    ))?;
    let path = Path::from("all_things");
    create_link(
        path.path_entry_hash()?,
        thing_hash.clone(),
        LinkTypes::AllThings,
        (),
    )?;
    Ok(record)
}
#[hdk_extern]
pub fn get_thing(original_thing_hash: ZomeFnInput<ActionHash>) -> ExternResult<Option<Record>> {
    let input = LinkQuery::try_new(original_thing_hash.input.clone(), LinkTypes::ThingUpdates)?;
    let links = get_links(input, original_thing_hash.get_strategy())?;
    get_latest_record_from_links_with_original_hash(
        links,
        original_thing_hash.input.clone(),
        original_thing_hash.get_options(),
    )
}
#[derive(Serialize, Deserialize, Debug)]
pub struct UpdateThingInput {
    pub original_thing_hash: ActionHash,
    pub previous_thing_hash: ActionHash,
    pub updated_thing: Thing,
}
#[hdk_extern]
pub fn update_thing(input: UpdateThingInput) -> ExternResult<Record> {
    let updated_thing_hash = update_entry(input.previous_thing_hash.clone(), &input.updated_thing)?;
    create_link(
        input.original_thing_hash.clone(),
        updated_thing_hash.clone(),
        LinkTypes::ThingUpdates,
        (),
    )?;
    let record = get(updated_thing_hash.clone(), GetOptions::local())?.ok_or(wasm_error!(
        WasmErrorInner::Guest(String::from("Could not find the newly updated Thing"))
    ))?;
    Ok(record)
}

#[hdk_extern]
pub fn delete_thing(original_thing_hash: ActionHash) -> ExternResult<ActionHash> {
    delete_entry(original_thing_hash)
}

#[hdk_extern]
pub fn get_things(input: ZomeFnInput<()>) -> ExternResult<Vec<Link>> {
    let path = Path::from("all_things");
    let query = LinkQuery::try_new(path.path_entry_hash()?, LinkTypes::AllThings)?;
    let links = get_links(query, input.get_strategy())?;

    Ok(links)
}

/// Assumes that the passed links has an action hash as target and tries to get the Record
/// associated to the target of the link with the latest timestamp
pub fn get_latest_record_from_links_with_original_hash(
    mut links: Vec<Link>,
    original_hash: ActionHash,
    get_options: GetOptions,
) -> ExternResult<Option<Record>> {
    links.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    for link in links {
        if let Some(action_hash) = link.target.into_action_hash() {
            let maybe_record = get(action_hash, get_options.clone())?;
            if let Some(record) = maybe_record {
                return Ok(Some(record));
            }
        }
    }
    Ok(get(original_hash, get_options)?)
}
