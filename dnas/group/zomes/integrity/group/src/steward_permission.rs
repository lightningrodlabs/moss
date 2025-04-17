use hdi::prelude::*;

use crate::GroupDnaProperties;
#[hdk_entry_helper]
#[derive(Clone, PartialEq)]
pub struct StewardPermission {
    pub permission_hash: Option<ActionHash>,
    pub for_agent: AgentPubKey,
    pub expiry: Option<Timestamp>,
}

/// Rules
/// 1. Only the progenitor or agents with a non-expiring StewardPermission can create a StewardPermission
/// 2. StewardPermissions cannot be created for oneself
/// 3. The progenitor cannot create a StewardPermission for themselves since they already have maximum permissions
pub fn validate_create_steward_permission(
    action: EntryCreationAction,
    steward_permission: StewardPermission,
) -> ExternResult<ValidateCallbackResult> {
    let dna_properties =
        GroupDnaProperties::try_from(dna_info()?.modifiers.properties).map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize DNA properties: {e}"
            )))
        })?;
    if let Some(progenitor_b64) = dna_properties.progenitor {
        let progenitor = AgentPubKey::from(progenitor_b64);
        if progenitor == steward_permission.for_agent {
            return Ok(ValidateCallbackResult::Invalid(
                "StewardPermission entries cannot be created for the progenitor.".into(),
            ));
        }
    }
    // StewardPermission entries cannot be issued for oneself
    if action.author() == &steward_permission.for_agent {
        return Ok(ValidateCallbackResult::Invalid(
            "StewardPermission entries cannot be created for oneself.".into(),
        ));
    }
    validate_steward_permission(
        action.author(),
        steward_permission.permission_hash,
        action.timestamp(),
        false,
    )
}
pub fn validate_update_steward_permission(
    _action: Update,
    _steward_permission: StewardPermission,
    _original_action: EntryCreationAction,
    _original_steward_permission: StewardPermission,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "Steward Permissions cannot be updated",
    )))
}
pub fn validate_delete_steward_permission(
    _action: Delete,
    _original_action: EntryCreationAction,
    _original_steward_permission: StewardPermission,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "Steward Permissions cannot be deleted",
    )))
}
/// Rules
/// 1. Link must point from an agent public key to a StewardPermission entry
/// 2. The agent public key from which the link is pointing away must be the
///    agent key for which the StewardPermission is issued
/// 3. The agent creating the link must have StewardPermission
pub fn validate_create_link_agent_to_steward_permissions(
    action: CreateLink,
    base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // TODO deserialize link tag here to get the permission hash if any
    let agent = match base_address
        .into_agent_pub_key()
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Link base is not an agent public key".to_string()
        ))) {
        Ok(a) => a,
        Err(e) => return Ok(ValidateCallbackResult::Invalid(e.into())),
    };
    let action_hash =
        match target_address
            .into_action_hash()
            .ok_or(wasm_error!(WasmErrorInner::Guest(
                "Link target is not an action hash".to_string()
            ))) {
            Ok(ah) => ah,
            Err(e) => return Ok(ValidateCallbackResult::Invalid(e.into())),
        };
    let record = must_get_valid_record(action_hash)?;
    let steward_permission: crate::StewardPermission = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Linked action must reference an entry".to_string()
        )))?;

    if agent != steward_permission.for_agent {
        return Ok(ValidateCallbackResult::Invalid(
            "Link is pointing to a StewardPermission of the wrong agent".into(),
        ));
    }

    validate_steward_permission(
        &action.author,
        steward_permission.permission_hash,
        &action.timestamp,
        false,
    )
}
pub fn validate_delete_link_agent_to_steward_permissions(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(String::from(
        "AgentToStewardPermissions links cannot be deleted",
    )))
}
/// Rules:
/// 1. Only agents with StewardPermission or the progenitor can create these links
/// 2. Agents with expiring StewardPermissions cannot create these links
/// 3. The link must point to a valid StewardPermission entry
/// 4. The link must point away from the all_steward_permissions anchor
/// 5. The link tag must contain the agent public key for which the permission is
pub fn validate_create_link_all_steward_permissions(
    action: CreateLink,
    base_address: AnyLinkableHash,
    target_address: AnyLinkableHash,
    tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    // Check that base address is pointing away from the all_developer_collectives anchor
    let base_address_entry_hash = EntryHash::try_from(base_address).map_err(|_| {
        wasm_error!(WasmErrorInner::Guest(
            "Base address is not an entry hash".into()
        ))
    })?;
    let path = Path::from("all_steward_permissions");
    if path.path_entry_hash()? != base_address_entry_hash {
        return Ok(ValidateCallbackResult::Invalid(
            "AllStewardPermissions link is not pointing away from the all_steward_permissions anchor."
                .into(),
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
    let steward_permission: crate::StewardPermission = record
        .entry()
        .to_app_option()
        .map_err(|e| wasm_error!(e))?
        .ok_or(wasm_error!(WasmErrorInner::Guest(
            "Linked action must reference an entry".to_string()
        )))?;

    // Validate that the tag is for the agent that the permission is for
    let agent_in_tag = AgentPubKey::try_from_raw_39(tag.0.clone()).map_err(|_| {
        wasm_error!(WasmErrorInner::Guest(
            "Link tag does not contain a valid agent public key".into()
        ))
    })?;

    if agent_in_tag != steward_permission.for_agent {
        return Ok(ValidateCallbackResult::Invalid(
            "Link tag contains the wrong agent public key.".into(),
        ));
    }

    validate_steward_permission(
        &action.author,
        steward_permission.permission_hash,
        &action.timestamp,
        false,
    )
}
pub fn validate_delete_link_all_steward_permissions(
    _action: DeleteLink,
    _original_action: CreateLink,
    _base: AnyLinkableHash,
    _target: AnyLinkableHash,
    _tag: LinkTag,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Invalid(
        "Links to StewardPermission entries cannot be deleted.".into(),
    ))
}

pub fn validate_steward_permission(
    agent: &AgentPubKey,
    permission_hash: Option<ActionHash>,
    timestamp: &Timestamp,
    allow_expiring_permissions: bool,
) -> ExternResult<ValidateCallbackResult> {
    let dna_properties =
        GroupDnaProperties::try_from(dna_info()?.modifiers.properties).map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize DNA properties: {e}"
            )))
        })?;

    match dna_properties.progenitor {
        Some(progenitor_b64) => {
            let progenitor = AgentPubKey::from(progenitor_b64);
            if &progenitor == agent {
                Ok(ValidateCallbackResult::Valid)
            } else {
                match permission_hash {
                    Some(ph) => {
                        // get permission record
                        let permission_record = must_get_valid_record(ph.clone())?;

                        let maybe_steward_permission = match permission_record
                            .entry()
                            .to_app_option::<StewardPermission>()
                        {
                            Ok(perm) => perm,
                            Err(_) => return Ok(ValidateCallbackResult::Invalid(
                                "permission hash does not point to a serializable StewardPermission entry"
                                    .into(),
                            )),
                        };

                        let steward_permission = match maybe_steward_permission {
                            Some(perm) => perm,
                            None => return Ok(ValidateCallbackResult::Invalid(
                                "permission hash does not point to a valid StewardPermission entry"
                                    .into(),
                            )),
                        };

                        // 1. Validate that permission is for the correct agent
                        if &steward_permission.for_agent != agent {
                            return Ok(ValidateCallbackResult::Invalid(
                                "StewardPermission is for the wrong agent.".into(),
                            ));
                        }

                        // 2. If the StewardPermission is has an expiry check whether expiring
                        //    permissions are allowed to take the given action
                        if let Some(_) = steward_permission.expiry {
                            if allow_expiring_permissions == false {
                                return Ok(ValidateCallbackResult::Invalid(
                                    "Only non-expiring StewardPermissions are allowed to take this action."
                                        .into(),
                                ));
                            }
                        }

                        // 3. Validate that the permission has not expired
                        if let Some(expiry) = steward_permission.expiry {
                            if &expiry < timestamp {
                                return Ok(ValidateCallbackResult::Invalid(
                                    "StewardPermission has expired.".into(),
                                ));
                            }
                        }

                        Ok(ValidateCallbackResult::Valid)
                    }
                    None => Ok(ValidateCallbackResult::Invalid(
                        "No valid permission hash provided and agent is not the progenitor".into(),
                    )),
                }
            }
        }
        None => Ok(ValidateCallbackResult::Valid),
    }
}
