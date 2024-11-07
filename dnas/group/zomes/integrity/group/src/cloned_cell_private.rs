use crate::cloned_cell::AppletClonedCell;
use hdi::prelude::*;

/// Entry to register cloned cells associated to Applets
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct AppletClonedCellPrivate {
    pub public_entry_hash: EntryHash,
    pub applet_cloned_cell: AppletClonedCell,
}
pub fn validate_create_applet_cloned_cell_private(
    _action: EntryCreationAction,
    _applet_cloned_cell_private: AppletClonedCellPrivate,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_update_applet_cloned_cell_private(
    _action: Update,
    _applet_cloned_cell_private: AppletClonedCell,
    _original_action: EntryCreationAction,
    _original_applet_cloned_cell_private: AppletClonedCellPrivate,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "AppletClonedCell entries cannot be updated",
    )))
}
pub fn validate_delete_applet_cloned_cell_private(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_applet_cloned_cell_private: AppletClonedCellPrivate,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "AppletClonedCell entries cannot be deleted",
    )))
}
// /// Rules
// /// 1. Link must point away from the all_applets anchor
// /// 2. Link must point to an entry hash
// pub fn validate_create_link_all_applets(
//     _action: CreateLink,
//     base_address: AnyLinkableHash,
//     target_address: AnyLinkableHash,
//     _tag: LinkTag,
// ) -> ExternResult<ValidateCallbackResult> {
//     // Check that base address is pointing away from the all_applets anchor
//     let base_address_entry_hash = EntryHash::try_from(base_address).map_err(|_| {
//         wasm_error!(WasmErrorInner::Guest(
//             "Base address is not an entry hash".into()
//         ))
//     })?;
//     let path = Path::from("all_applets");
//     if path.path_entry_hash()? != base_address_entry_hash {
//         return Ok(ValidateCallbackResult::Invalid(
//             "AllApplets link is not pointing away from the all_applets anchor".into(),
//         ));
//     }
//     // Check the entry type for the given action hash
//     let _entry_hash =
//         target_address
//             .into_entry_hash()
//             .ok_or(wasm_error!(WasmErrorInner::Guest(
//                 "No entry hash associated with link".to_string()
//             )))?;
//     Ok(ValidateCallbackResult::Valid)
// }

// /// Rules
// /// 1. Links can only be removed by the agent that originally created the link
// ///    or the group's progenitor. This is due to a lack of the ability to pass
// ///    a permission hash along with a delete link action.
// pub fn validate_delete_link_all_applets(
//     action: DeleteLink,
//     _original_action: CreateLink,
//     _base: AnyLinkableHash,
//     target: AnyLinkableHash,
//     _tag: LinkTag,
// ) -> ExternResult<ValidateCallbackResult> {
//     let dna_properties =
//         GroupDnaProperties::try_from(dna_info()?.modifiers.properties).map_err(|e| {
//             wasm_error!(WasmErrorInner::Guest(format!(
//                 "Failed to deserialize DNA properties: {e}"
//             )))
//         })?;

//     match dna_properties.progenitor {
//         Some(progenitor_b64) => {
//             let progenitor = AgentPubKey::from(progenitor_b64);
//             if progenitor == action.author {
//                 return Ok(ValidateCallbackResult::Valid);
//             }
//         }
//         None => return Ok(ValidateCallbackResult::Valid),
//     }

//     let action_hash = target
//         .into_action_hash()
//         .ok_or(wasm_error!(WasmErrorInner::Guest(
//             "No action hash associated with link".to_string()
//         )))?;

//     let record = must_get_valid_record(action_hash)?;
//     let applet: Applet = record
//         .entry()
//         .to_app_option()
//         .map_err(|e| wasm_error!(e))?
//         .ok_or(wasm_error!(WasmErrorInner::Guest(
//             "Linked action must reference an Applet entry".to_string()
//         )))?;

//     validate_steward_permission(
//         &action.author,
//         applet.permission_hash,
//         &action.timestamp,
//         true,
//     )
// }
