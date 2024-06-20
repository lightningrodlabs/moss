use foyer_integrity::*;
use hdk::prelude::*;

#[hdk_extern]
pub fn create_thing(thing: Thing) -> ExternResult<Record> {
    let thing_hash = create_entry(&EntryTypes::Thing(thing.clone()))?;
    let record = get(thing_hash.clone(), GetOptions::default())?.ok_or(wasm_error!(
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
pub fn get_thing(original_thing_hash: ActionHash) -> ExternResult<Option<Record>> {
    let input =
        GetLinksInputBuilder::try_new(original_thing_hash.clone(), LinkTypes::ThingUpdates)?
            .build();
    let links = get_links(input)?;
    let latest_link = links
        .into_iter()
        .max_by(|link_a, link_b| link_a.timestamp.cmp(&link_b.timestamp));
    let latest_thing_hash = match latest_link {
        Some(link) => ActionHash::try_from(link.target.clone()).map_err(|err| wasm_error!(err))?,
        None => original_thing_hash.clone(),
    };
    get(latest_thing_hash, GetOptions::default())
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
    let record = get(updated_thing_hash.clone(), GetOptions::default())?.ok_or(wasm_error!(
        WasmErrorInner::Guest(String::from("Could not find the newly updated Thing"))
    ))?;
    Ok(record)
}

#[hdk_extern]
pub fn delete_thing(original_thing_hash: ActionHash) -> ExternResult<ActionHash> {
    delete_entry(original_thing_hash)
}

#[hdk_extern]
pub fn get_things(_: ()) -> ExternResult<Vec<Link>> {
    let path = Path::from("all_things");
    let input =
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AllThings)?.build();
    let links = get_links(input)?;

    Ok(links)
}
