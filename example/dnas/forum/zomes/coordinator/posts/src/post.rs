use hdk::prelude::*;
use posts_integrity::*;
#[hdk_extern]
pub fn create_post(post: Post) -> ExternResult<Record> {
    let post_hash = create_entry(&EntryTypes::Post(post.clone()))?;
    let record = get(post_hash.clone(), GetOptions::default())?.ok_or(wasm_error!(
        WasmErrorInner::Guest(String::from("Could not find the newly created Post"))
    ))?;
    let path = Path::from("all_posts");
    create_link(
        path.path_entry_hash()?,
        post_hash.clone(),
        LinkTypes::AllPosts,
        (),
    )?;
    Ok(record)
}
#[hdk_extern]
pub fn get_post(original_post_hash: ActionHash) -> ExternResult<Option<Record>> {
    let links = get_links(
        GetLinksInputBuilder::try_new(original_post_hash.clone(), LinkTypes::PostUpdates)?.build(),
    )?;
    println!("get_post: {:?}", links);
    get_latest_record_from_links_with_original_hash(links, original_post_hash)
}
#[derive(Serialize, Deserialize, Debug)]
pub struct UpdatePostInput {
    pub original_post_hash: ActionHash,
    pub previous_post_hash: ActionHash,
    pub updated_post: Post,
}
#[hdk_extern]
pub fn update_post(input: UpdatePostInput) -> ExternResult<Record> {
    let updated_post_hash = update_entry(input.previous_post_hash.clone(), &input.updated_post)?;
    create_link(
        input.original_post_hash.clone(),
        updated_post_hash.clone(),
        LinkTypes::PostUpdates,
        (),
    )?;
    let record = get(updated_post_hash.clone(), GetOptions::default())?.ok_or(wasm_error!(
        WasmErrorInner::Guest(String::from("Could not find the newly updated Post"))
    ))?;
    Ok(record)
}
#[hdk_extern]
pub fn delete_post(original_post_hash: ActionHash) -> ExternResult<ActionHash> {
    delete_entry(original_post_hash)
}

/// Assumes that the passed links has an action hash as target and tries to get the Record
/// associated to the target of the link with the latest timestamp
pub fn get_latest_record_from_links_with_original_hash(
    mut links: Vec<Link>,
    original_hash: ActionHash,
) -> ExternResult<Option<Record>> {
    links.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    println!("Getting latest record from links: {:?}", links);
    debug!("Getting latest record from links: {:?}", links);
    for link in links {
        if let Some(action_hash) = link.target.into_action_hash() {
            let maybe_record = get(action_hash, GetOptions::default())?;
            println!("Got record: {:?}", maybe_record);
            debug!("Got record: {:?}", maybe_record);
            if let Some(record) = maybe_record {
                return Ok(Some(record));
            }
        }
    }
    Ok(get(original_hash, GetOptions::default())?)
}
