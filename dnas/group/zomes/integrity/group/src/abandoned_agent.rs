use hdi::prelude::*;

/// Rules
/// 1. Link base must be an Applet entry
/// 2. Link target must be the agent public key of the link creator
pub fn validate_create_link_abandoned_agent(
    action: CreateLink,
    base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // Check the entry type for the given action hash
    let action_hash = base_address
        .into_action_hash()
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "No action hash associated with link".to_string()
        )))?;
    let record = must_get_valid_record(action_hash)?;
    let _applet: crate::Applet = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Linked action must reference an entry".to_string()
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
            "AppletToAbandonedAgent links must point to the creator of the link.".into(),
        ));
    }

    Ok(ValidateCallbackResult::Valid)
}

/// Rules
/// 1. Only the creator of the link can delete the link.
pub fn validate_delete_link_abandoned_agent(
    action: DeleteLink,
    original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    if action.author != original_action.author {
        return Ok(ValidateCallbackResult::Invalid(
            "Only the creator of an AppletToAbandonedAgent link can delete that link.".into(),
        ));
    }
    Ok(ValidateCallbackResult::Valid)
}
