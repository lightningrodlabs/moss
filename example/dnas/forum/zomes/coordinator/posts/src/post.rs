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
    let links = get_links(original_post_hash.clone(), LinkTypes::PostUpdates, None)?;
    let latest_link = links
        .into_iter()
        .max_by(|link_a, link_b| link_a.timestamp.cmp(&link_b.timestamp));
    let latest_post_hash = match latest_link {
        Some(link) => ActionHash::try_from(link.target.clone())
            .map_err(|e| wasm_error!(WasmErrorInner::from(e)))?,
        // Some(link) => ActionHash::from(link.target.clone()),
        None => original_post_hash.clone(),
    };
    get(latest_post_hash, GetOptions::default())
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
