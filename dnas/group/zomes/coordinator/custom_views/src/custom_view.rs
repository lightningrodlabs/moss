use hdk::prelude::*;
use custom_views_integrity::*;
#[hdk_extern]
pub fn create_custom_view(custom_view: CustomView) -> ExternResult<Record> {
    let custom_view_hash = create_entry(&EntryTypes::CustomView(custom_view.clone()))?;
    let record = get(custom_view_hash.clone(), GetOptions::default())?
        .ok_or(
            wasm_error!(
                WasmErrorInner::Guest(String::from("Could not find the newly created CustomView"))
            ),
        )?;
    let path = Path::from("all_custom_views");
    create_link(
        path.path_entry_hash()?,
        custom_view_hash.clone(),
        LinkTypes::AllCustomViews,
        (),
    )?;
    Ok(record)
}
#[hdk_extern]
pub fn get_custom_view(
    original_custom_view_hash: ActionHash,
) -> ExternResult<Option<Record>> {
    get_latest_custom_view(original_custom_view_hash)
}
fn get_latest_custom_view(custom_view_hash: ActionHash) -> ExternResult<Option<Record>> {
    let details = get_details(custom_view_hash, GetOptions::default())?
        .ok_or(wasm_error!(WasmErrorInner::Guest("CustomView not found".into())))?;
    let record_details = match details {
        Details::Entry(_) => {
            Err(wasm_error!(WasmErrorInner::Guest("Malformed details".into())))
        }
        Details::Record(record_details) => Ok(record_details),
    }?;
    if record_details.deletes.len() > 0 {
        return Ok(None);
    }
    match record_details.updates.last() {
        Some(update) => get_latest_custom_view(update.action_address().clone()),
        None => Ok(Some(record_details.record)),
    }
}
#[derive(Serialize, Deserialize, Debug)]
pub struct UpdateCustomViewInput {
    pub previous_custom_view_hash: ActionHash,
    pub updated_custom_view: CustomView,
}
#[hdk_extern]
pub fn update_custom_view(input: UpdateCustomViewInput) -> ExternResult<Record> {
    let updated_custom_view_hash = update_entry(
        input.previous_custom_view_hash,
        &input.updated_custom_view,
    )?;
    let record = get(updated_custom_view_hash.clone(), GetOptions::default())?
        .ok_or(
            wasm_error!(
                WasmErrorInner::Guest(String::from("Could not find the newly updated CustomView"))
            ),
        )?;
    Ok(record)
}
#[hdk_extern]
pub fn delete_custom_view(
    original_custom_view_hash: ActionHash,
) -> ExternResult<ActionHash> {
    delete_entry(original_custom_view_hash)
}
