use crate::validate_steward_permission;
use hdi::prelude::*;
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct GroupMetaData {
    pub permission_hash: Option<ActionHash>,
    pub name: String,
    pub data: String,
}
pub fn validate_create_group_meta_data(
    action: EntryCreationAction,
    group_meta_data: GroupMetaData,
) -> ExternResult<ValidateCallbackResult> {
    validate_steward_permission(
        action.author(),
        group_meta_data.permission_hash,
        action.timestamp(),
        true,
    )
}
pub fn validate_update_group_meta_data(
    _action: Update,
    _group_meta_data: GroupMetaData,
    _original_action: EntryCreationAction,
    _original_group_meta_data: GroupMetaData,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "GroupMetaData entries cannot be updated",
    )))
}
pub fn validate_delete_group_meta_data(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_group_meta_data: GroupMetaData,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "GroupMetaData entries cannot be deleted",
    )))
}

/// Rules
/// 1. Link must point away from the correctly named anchor
/// 2. Link must point to a valid GroupMetaData entry
/// 3. The creator of the link must be the one that created the GroupMetaData entry
pub fn validate_create_link_group_meta_data_to_anchor(
    action: CreateLink,
    base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // Check the entry type for the given action hash
    let action_hash =
        target_address
            .into_action_hash()
            .ok_or(wasm_error!(WasmErrorInner::Guest(
                "No action hash associated with link".to_string()
            )))?;
    let record = must_get_valid_record(action_hash)?;
    let group_meta_data: GroupMetaData = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Linked action must reference an entry".to_string()
        )))?;

    // Check that base address is pointing away from the correctly named anchor
    let base_address_entry_hash = EntryHash::try_from(base_address).map_err(|_| {
        wasm_error!(WasmErrorInner::Guest(
            "Base address is not an entry hash".into()
        ))
    })?;
    let path = Path::from(group_meta_data.name.as_str());
    if path.path_entry_hash()? != base_address_entry_hash {
        return Ok(ValidateCallbackResult::Invalid(
            "GroupMetaDataToAnchor link is not pointing away from the correctly named anchor"
                .into(),
        ));
    }

    if record.action().author() != &action.author {
        return Ok(ValidateCallbackResult::Invalid("Only the creator of a GroupMetaData entry can create a link from the GroupMetaData its corresponding anchor".into()));
    }
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_delete_link_group_meta_data_to_anchor(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(
        "Links to group meta data entries cannot be deleted.".into(),
    ))
}
