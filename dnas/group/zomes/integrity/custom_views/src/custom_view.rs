use hdi::prelude::*;
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct CustomView {
    pub name: String,
    pub logo: String,
    pub html: String,
    pub js: String,
    pub css: String,
}
pub fn validate_create_custom_view(
    _action: EntryCreationAction,
    _custom_view: CustomView,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_update_custom_view(
    _action: Update,
    _custom_view: CustomView,
    _original_action: EntryCreationAction,
    _original_custom_view: CustomView,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_delete_custom_view(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_custom_view: CustomView,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_create_link_all_custom_views(
    _action: CreateLink,
    _base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // Check the entry type for the given action hash
    // let action_hash = ActionHash::from(target_address);
    let action_hash = ActionHash::try_from(target_address)
        .map_err(|e| wasm_error!(WasmErrorInner::from(e)))?;
    let record = must_get_valid_record(action_hash)?;
    let _custom_view: crate::CustomView = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(String::from(
            "Linked action must reference an entry"
        ))))?;
    // TODO: add the appropriate validation rules
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_delete_link_all_custom_views(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "AllCustomViews links cannot be deleted",
    )))
}
