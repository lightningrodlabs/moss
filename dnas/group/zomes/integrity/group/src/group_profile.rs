use crate::validate_steward_permission;
use hdi::prelude::*;
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct GroupProfile {
    pub permission_hash: Option<ActionHash>,
    pub name: String,
    pub icon_src: String,
    pub meta_data: Option<String>,
}
pub fn validate_create_group_profile(
    action: EntryCreationAction,
    group_profile: GroupProfile,
) -> ExternResult<ValidateCallbackResult> {
    if group_profile.icon_src.chars().count() > 300000 {
        return Ok(ValidateCallbackResult::Invalid(
            "The group icon is not allowed to be larger than 300'000 characters (approx. 200KB)"
                .into(),
        ));
    }
    validate_steward_permission(
        action.author(),
        group_profile.permission_hash,
        action.timestamp(),
        true,
    )
}
pub fn validate_update_group_profile(
    _action: Update,
    _group_profile: GroupProfile,
    _original_action: EntryCreationAction,
    _original_group_profile: GroupProfile,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "Group Profiles cannot be updated",
    )))
}
pub fn validate_delete_group_profile(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_group_profile: GroupProfile,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "Group Profiles cannot be deleted",
    )))
}

/// Rules
/// 1. Link must point away from the all_group_profiles anchor
/// 2. Link must point to a valid GroupProfile entry
/// 3. The creator of the link must be the one that created the GroupProfile entry
pub fn validate_create_link_all_group_profiles(
    action: CreateLink,
    base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // Check that base address is pointing away from the all_group_profiles anchor
    let base_address_entry_hash = EntryHash::try_from(base_address).map_err(|_| {
        wasm_error!(WasmErrorInner::Guest(
            "Base address is not an entry hash".into()
        ))
    })?;
    let path = Path::from("all_group_profiles");
    if path.path_entry_hash()? != base_address_entry_hash {
        return Ok(ValidateCallbackResult::Invalid(
            "AllGroupProfiles link is not pointing away from the all_group_profiles anchor".into(),
        ));
    }

    // Check the entry type for the given action hash
    let action_hash =
        target_address
            .into_action_hash()
            .ok_or(wasm_error!(WasmErrorInner::Guest(
                "No action hash associated with link".to_string()
            )))?;
    let record = must_get_valid_record(action_hash)?;
    let _group_profile: GroupProfile = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Linked action must reference an entry".to_string()
        )))?;

    if record.action().author() != &action.author {
        return Ok(ValidateCallbackResult::Invalid("Only the creator of a GroupProfile entry can create a link from the GroupProfile to the all_group_profiles anchor".into()));
    }
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_delete_link_all_group_profiles(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(
        "Links to group profiles cannot be deleted.".into(),
    ))
}
