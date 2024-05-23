use crate::{validate_steward_permission, GroupDnaProperties};
use hdi::prelude::*;
use std::collections::BTreeMap;
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct Applet {
    pub permission_hash: Option<ActionHash>,
    pub custom_name: String,
    pub description: String,
    pub sha256_happ: String,
    pub sha256_ui: Option<String>,
    pub sha256_webhapp: Option<String>,
    pub distribution_info: String,
    pub meta_data: Option<String>,
    pub network_seed: Option<String>,
    pub properties: BTreeMap<String, SerializedBytes>,
}
pub fn validate_create_applet(
    action: EntryCreationAction,
    applet: Applet,
) -> ExternResult<ValidateCallbackResult> {
    validate_steward_permission(
        action.author(),
        applet.permission_hash,
        action.timestamp(),
        true,
    )
}
pub fn validate_update_applet(
    _action: Update,
    _applet: Applet,
    _original_action: EntryCreationAction,
    _original_applet: Applet,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "Applets cannot be updated",
    )))
}
pub fn validate_delete_applet(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_applet: Applet,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "Applets cannot be deleted",
    )))
}
/// Rules
/// 1. Link must point away from the all_applets anchor
/// 2. Link must point to a valid Applet entry
/// 3. The creator of the link must be the one that created the Applet entry
pub fn validate_create_link_all_applets(
    action: CreateLink,
    base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // Check that base address is pointing away from the all_applets anchor
    let base_address_entry_hash = EntryHash::try_from(base_address).map_err(|_| {
        wasm_error!(WasmErrorInner::Guest(
            "Base address is not an entry hash".into()
        ))
    })?;
    let path = Path::from("all_applets");
    if path.path_entry_hash()? != base_address_entry_hash {
        return Ok(ValidateCallbackResult::Invalid(
            "AllApplets link is not pointing away from the all_applets anchor".into(),
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
    let _applet: Applet = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Linked action must reference an entry".to_string()
        )))?;

    if record.action().author() != &action.author {
        return Ok(ValidateCallbackResult::Invalid("Only the creator of an Applet entry can create a link from the Applet to the all_applets anchor".into()));
    }
    Ok(ValidateCallbackResult::Valid)
}

/// Rules
/// 1. Links can only be removed by the agent that originally created the link
///    or the group's progenitor. This is due to a lack of the ability to pass
///    a permission hash along with a delete link action.
pub fn validate_delete_link_all_applets(
    action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    let dna_properties =
        GroupDnaProperties::try_from(dna_info()?.modifiers.properties).map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize DNA properties: {e}"
            )))
        })?;

    match dna_properties.progenitor {
        Some(progenitor) => {
            if progenitor == action.author {
                return Ok(ValidateCallbackResult::Valid);
            }
        }
        None => return Ok(ValidateCallbackResult::Valid),
    }

    let action_hash = target
        .into_action_hash()
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "No action hash associated with link".to_string()
        )))?;

    let record = must_get_valid_record(action_hash)?;
    let applet: Applet = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Linked action must reference an Applet entry".to_string()
        )))?;

    validate_steward_permission(
        &action.author,
        applet.permission_hash,
        &action.timestamp,
        true,
    )
}
