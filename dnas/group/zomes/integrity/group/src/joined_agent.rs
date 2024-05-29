use hdi::prelude::*;

/// Rules
/// 1. Link base must be an entry hash
/// 2. Link target must be the agent public key of the link creator
pub fn validate_create_link_joined_agent(
    action: CreateLink,
    base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // Check the entry type for the given action hash
    let _entry_hash = base_address
        .into_entry_hash()
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "No action hash associated with link".to_string()
        )))?;

    let agent = match target_address
        .into_agent_pub_key()
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Link base is not an agent public key".to_string()
        ))) {
        Ok(a) => a,
        Err(e) => return Ok(ValidateCallbackResult::Invalid(e.into())),
    };

    if agent != action.author {
        return Ok(ValidateCallbackResult::Invalid(
            "AppletToJoinedAgent links must point to the creator of the link.".into(),
        ));
    }

    Ok(ValidateCallbackResult::Valid)
}

/// Rules
/// 1. Only the creator of the link can delete the link.
pub fn validate_delete_link_joined_agent(
    action: DeleteLink,
    original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    if action.author != original_action.author {
        return Ok(ValidateCallbackResult::Invalid(
            "Only the creator of an AppletToJoinedAgent link can delete that link.".into(),
        ));
    }
    Ok(ValidateCallbackResult::Valid)
}
