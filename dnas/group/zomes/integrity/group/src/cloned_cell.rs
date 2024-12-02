use hdi::prelude::*;
use std::time::Duration;

/// Entry to register cloned cells associated to Applets
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct AppletClonedCell {
    pub applet_hash: EntryHash,
    pub dna_hash: DnaHash,
    pub role_name: String,
    pub network_seed: Option<String>,
    pub properties: Option<SerializedBytes>,
    pub origin_time: Option<Timestamp>,
    pub quantum_time: Option<Duration>,
    // NOTE: It might in some cases in the future be desirable to share a membrane proof here
    // too in case it is not bound to an agent.
}
pub fn validate_create_applet_cloned_cell(
    _action: EntryCreationAction,
    _applet_cloned_cell: AppletClonedCell,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_update_applet_cloned_cell(
    _action: Update,
    _applet_cloned_cell: AppletClonedCell,
    _original_action: EntryCreationAction,
    _original_applet_cloned_cell: AppletClonedCell,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "AppletClonedCell entries cannot be updated",
    )))
}
pub fn validate_delete_applet_cloned_cell(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_applet_cloned_cell: AppletClonedCell,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "AppletClonedCell entries cannot be deleted",
    )))
}

/// Rules
/// 1. Link must point away from an Applet entry (by entry hash)
/// 2. Link must point to an AppletClonedCell entry (by entry hash)
pub fn validate_create_link_applet_to_applet_cloned_cell(
    _action: CreateLink,
    base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    base_address
        .into_entry_hash()
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Base address is not an entry hash".to_string()
        )))?;
    target_address
        .into_entry_hash()
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Target address is not an entry hash".to_string()
        )))?;
    Ok(ValidateCallbackResult::Valid)
}

/// Rules
/// Allowed
pub fn validate_delete_link_applet_to_applet_cloned_cell(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
