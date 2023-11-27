use hdi::prelude::*;

use crate::LinkTypes;
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct Post {
    pub title: String,
    pub content: String,
}
pub fn validate_create_post(
    _action: EntryCreationAction,
    _post: Post,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_update_post(
    _action: Update,
    _post: Post,
    _original_action: EntryCreationAction,
    _original_post: Post,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_delete_post(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_post: Post,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_create_link_post_updates(
    _action: CreateLink,
    base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    let action_hash =
        ActionHash::try_from(base_address).map_err(|e| wasm_error!(WasmErrorInner::from(e)))?;
    // let action_hash = ActionHash::from(base_address);
    let record = must_get_valid_record(action_hash)?;
    let _post: crate::Post = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(String::from(
            "Linked action must reference an entry"
        ))))?;
    let action_hash =
        ActionHash::try_from(target_address).map_err(|e| wasm_error!(WasmErrorInner::from(e)))?;
    // let action_hash = ActionHash::from(target_address);
    let record = must_get_valid_record(action_hash)?;
    let _post: crate::Post = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(String::from(
            "Linked action must reference an entry"
        ))))?;
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_delete_link_post_updates(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "PostUpdates links cannot be deleted",
    )))
}
pub fn validate_delete_link_peer_subscription(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "PostUpdates links cannot be deleted",
    )))
}
pub fn validate_create_link_all_posts(
    _action: CreateLink,
    _base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // Check the entry type for the given action hash
    let action_hash =
        ActionHash::try_from(target_address).map_err(|e| wasm_error!(WasmErrorInner::from(e)))?;
    // let action_hash = ActionHash::from(target_address);
    let record = must_get_valid_record(action_hash)?;
    let _post: crate::Post = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(String::from(
            "Linked action must reference an entry"
        ))))?;
    // TODO: add the appropriate validation rules
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_delete_link_all_posts(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "AllPosts links cannot be deleted",
    )))
}
pub fn validate_create_link_peer_subscription(
    action: CreateLink,
    base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // Check whether the link points to the correct anchor
    // let peers_anchor = anchor(LinkTypes::PeerSubscription, String::from("PEER_SUBSCRIPTION"), String::from("PEER_SUBSCRIPTION"))?;
    // let base_address = EntryHash::try_from(base_address);
    // match base_address {
    //     Ok(address) => {
    //         if hash_entry(peers_anchor)? !=  address {
    //             return Ok(ValidateCallbackResult::Invalid(String::from(
    //                 "PeerSubscription link does not point to the correct anchor.",
    //             )))
    //         }
    //     },
    //     Err(e) =>  return Ok(ValidateCallbackResult::Invalid(String::from(
    //         "PeerSubscription link base is not an EntryHash.",
    //     )))
    // }

    // Check whether the target is the agent pubkey of the link creator
    let target = AgentPubKey::try_from(target_address);
    // match target {
    //     Ok(address) => {
    //         if action.author != address {
    //             return Ok(ValidateCallbackResult::Invalid(String::from(
    //                 "PeerSubscription link does not point to the AgentPubKey of the link creator.",
    //             )))
    //         }
    //     },
    //     Err(_e) => return Ok(ValidateCallbackResult::Invalid(String::from(
    //         "PeerSubscription link target is not an AgentPubKey.",
    //     ))),
    // }
    Ok(ValidateCallbackResult::Valid)
}