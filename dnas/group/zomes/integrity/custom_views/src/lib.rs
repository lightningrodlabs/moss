pub mod custom_view;
pub use custom_view::*;
use hdi::prelude::*;
#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
#[hdk_entry_types]
#[unit_enum(UnitEntryTypes)]
pub enum EntryTypes {
    CustomView(CustomView),
}
#[derive(Serialize, Deserialize)]
#[hdk_link_types]
pub enum LinkTypes {
    AllCustomViews,
}
#[hdk_extern]
pub fn genesis_self_check(_data: GenesisSelfCheckData) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
pub fn validate_agent_joining(
    _agent_pub_key: AgentPubKey,
    _membrane_proof: &Option<MembraneProof>,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
// TODO: fix name of this function
#[hdk_extern]
pub fn validatee(op: Op) -> ExternResult<ValidateCallbackResult> {
    match op.flattened::<EntryTypes, LinkTypes>()? {
        FlatOp::CreateEntry(store_entry) => match store_entry {
            OpEntry::CreateEntry { app_entry, action } => match app_entry {
                EntryTypes::CustomView(custom_view) => {
                    validate_create_custom_view(action.into(), custom_view)
                }
            },
            OpEntry::UpdateEntry {
                app_entry, action, ..
            } => match app_entry {
                EntryTypes::CustomView(custom_view) => {
                    validate_create_custom_view(action.into(), custom_view)
                }
            },
            _ => Ok(ValidateCallbackResult::Valid),
        },
        FlatOp::Update(update_entry) => match update_entry {
            OpUpdate::Entry { app_entry, action } => {
                let original_action_address = action.data.original_action_address.clone();
                let original_action = must_get_action(original_action_address.clone())?
                    .action()
                    .to_owned();
                if !matches!(
                    original_action.data,
                    ActionData::Create(_) | ActionData::Update(_)
                ) {
                    return Ok(ValidateCallbackResult::Invalid(
                        "Original action for an update must be a Create or Update action"
                            .to_string(),
                    ));
                }
                match app_entry {
                    EntryTypes::CustomView(custom_view) => {
                        let original_app_entry =
                            must_get_valid_record(original_action_address)?;
                        let original_custom_view = match CustomView::try_from(original_app_entry) {
                            Ok(entry) => entry,
                            Err(e) => {
                                return Ok(ValidateCallbackResult::Invalid(format!(
                                    "Expected to get CustomView from Record: {e:?}"
                                )));
                            }
                        };
                        validate_update_custom_view(
                            action.into(),
                            custom_view,
                            original_action,
                            original_custom_view,
                        )
                    }
                }
            }
            _ => Ok(ValidateCallbackResult::Valid),
        },
        FlatOp::Delete(delete_entry) => {
            let action = delete_entry.action;
            let original_action_hash = action.data.deletes_address.clone();
            let original_record = must_get_valid_record(original_action_hash)?;
            let original_action = original_record.action().clone();
            if !matches!(
                original_action.data,
                ActionData::Create(_) | ActionData::Update(_)
            ) {
                return Ok(ValidateCallbackResult::Invalid(
                    "Original action for a delete must be a Create or Update action".to_string(),
                ));
            }
            let app_entry_type = match original_action.entry_type() {
                Some(EntryType::App(app_entry_type)) => app_entry_type.clone(),
                _ => {
                    return Ok(ValidateCallbackResult::Valid);
                }
            };
            let entry = match original_record.entry().as_option() {
                Some(entry) => entry,
                None => {
                    return Ok(ValidateCallbackResult::Invalid(
                        "Original record for a delete must contain an entry".to_string(),
                    ));
                }
            };
            let original_app_entry = match EntryTypes::deserialize_from_type(
                app_entry_type.zome_index,
                app_entry_type.entry_index,
                entry,
            )? {
                Some(app_entry) => app_entry,
                None => {
                    return Ok(ValidateCallbackResult::Invalid(
                        "Original app entry must be one of the defined entry types for this zome"
                            .to_string(),
                    ));
                }
            };
            match original_app_entry {
                EntryTypes::CustomView(custom_view) => {
                    validate_delete_custom_view(action.into(), original_action, custom_view)
                }
            }
        }
        FlatOp::Link(OpLink::CreateLink { link_type, action }) => {
            let base_address = action.data.base_address.clone();
            let target_address = action.data.target_address.clone();
            let tag = action.data.tag.clone();
            match link_type {
                LinkTypes::AllCustomViews => validate_create_link_all_custom_views(
                    action.into(),
                    base_address,
                    target_address,
                    tag,
                ),
            }
        }
        FlatOp::Link(OpLink::DeleteLink {
            link_type,
            original_action,
            action,
        }) => {
            let base_address = action.data.base_address.clone();
            let target_address = original_action.data.target_address.clone();
            let tag = original_action.data.tag.clone();
            match link_type {
                LinkTypes::AllCustomViews => validate_delete_link_all_custom_views(
                    action.into(),
                    original_action.into(),
                    base_address,
                    target_address,
                    tag,
                ),
            }
        }
        FlatOp::CreateRecord(store_record) => match store_record {
            OpRecord::CreateEntry { app_entry, action } => match app_entry {
                EntryTypes::CustomView(custom_view) => {
                    validate_create_custom_view(action.into(), custom_view)
                }
            },
            OpRecord::UpdateEntry { app_entry, action } => {
                let original_record =
                    must_get_valid_record(action.data.original_action_address.clone())?;
                let original_action = original_record.action().clone();
                if !matches!(
                    original_action.data,
                    ActionData::Create(_) | ActionData::Update(_)
                ) {
                    return Ok(ValidateCallbackResult::Invalid(
                        "Original action for an update must be a Create or Update action"
                            .to_string(),
                    ));
                }
                match app_entry {
                    EntryTypes::CustomView(custom_view) => {
                        let result = validate_create_custom_view(
                            action.clone().into(),
                            custom_view.clone(),
                        )?;
                        if let ValidateCallbackResult::Valid = result {
                            let original_custom_view: Option<CustomView> = original_record
                                .entry()
                                .to_app_option()
                                .map_err(|e| wasm_error!(e))?;
                            let original_custom_view = match original_custom_view {
                                Some(custom_view) => custom_view,
                                None => {
                                    return Ok(
                                            ValidateCallbackResult::Invalid(
                                                "The updated entry type must be the same as the original entry type"
                                                    .to_string(),
                                            ),
                                        );
                                }
                            };
                            validate_update_custom_view(
                                action.into(),
                                custom_view,
                                original_action,
                                original_custom_view,
                            )
                        } else {
                            Ok(result)
                        }
                    }
                }
            }
            OpRecord::DeleteEntry { action } => {
                let original_record = must_get_valid_record(action.data.deletes_address.clone())?;
                let original_action = original_record.action().clone();
                if !matches!(
                    original_action.data,
                    ActionData::Create(_) | ActionData::Update(_)
                ) {
                    return Ok(ValidateCallbackResult::Invalid(
                        "Original action for a delete must be a Create or Update action"
                            .to_string(),
                    ));
                }
                let app_entry_type = match original_action.entry_type() {
                    Some(EntryType::App(app_entry_type)) => app_entry_type.clone(),
                    _ => {
                        return Ok(ValidateCallbackResult::Valid);
                    }
                };
                let entry = match original_record.entry().as_option() {
                    Some(entry) => entry,
                    None => {
                        if app_entry_type.visibility.is_public() {
                            return Ok(
                                    ValidateCallbackResult::Invalid(
                                        "Original record for a delete of a public entry must contain an entry"
                                            .to_string(),
                                    ),
                                );
                        } else {
                            return Ok(ValidateCallbackResult::Valid);
                        }
                    }
                };
                let original_app_entry = match EntryTypes::deserialize_from_type(
                    app_entry_type.zome_index,
                    app_entry_type.entry_index,
                    &entry,
                )? {
                    Some(app_entry) => app_entry,
                    None => {
                        return Ok(
                                ValidateCallbackResult::Invalid(
                                    "Original app entry must be one of the defined entry types for this zome"
                                        .to_string(),
                                ),
                            );
                    }
                };
                match original_app_entry {
                    EntryTypes::CustomView(original_custom_view) => validate_delete_custom_view(
                        action.into(),
                        original_action,
                        original_custom_view,
                    ),
                }
            }
            OpRecord::CreateLink { link_type, action } => {
                let base_address = action.data.base_address.clone();
                let target_address = action.data.target_address.clone();
                let tag = action.data.tag.clone();
                match link_type {
                    LinkTypes::AllCustomViews => validate_create_link_all_custom_views(
                        action.into(),
                        base_address,
                        target_address,
                        tag,
                    ),
                }
            }
            OpRecord::DeleteLink { action } => {
                let base_address = action.data.base_address.clone();
                let record = must_get_valid_record(action.data.link_add_address.clone())?;
                let original_action = record.action().clone();
                let create_link = match &original_action.data {
                    ActionData::CreateLink(create_link) => create_link.clone(),
                    _ => {
                        return Ok(ValidateCallbackResult::Invalid(
                            "The action that a DeleteLink deletes must be a CreateLink".to_string(),
                        ));
                    }
                };
                let link_type =
                    match LinkTypes::from_type(create_link.zome_index, create_link.link_type)? {
                        Some(lt) => lt,
                        None => {
                            return Ok(ValidateCallbackResult::Valid);
                        }
                    };
                match link_type {
                    LinkTypes::AllCustomViews => validate_delete_link_all_custom_views(
                        action.into(),
                        original_action,
                        base_address,
                        create_link.target_address,
                        create_link.tag,
                    ),
                }
            }
            OpRecord::CreatePrivateEntry { .. } => Ok(ValidateCallbackResult::Valid),
            OpRecord::UpdatePrivateEntry { .. } => Ok(ValidateCallbackResult::Valid),
            OpRecord::CreateCapClaim { .. } => Ok(ValidateCallbackResult::Valid),
            OpRecord::CreateCapGrant { .. } => Ok(ValidateCallbackResult::Valid),
            OpRecord::UpdateCapClaim { .. } => Ok(ValidateCallbackResult::Valid),
            OpRecord::UpdateCapGrant { .. } => Ok(ValidateCallbackResult::Valid),
            OpRecord::Dna { .. } => Ok(ValidateCallbackResult::Valid),
            OpRecord::OpenChain { .. } => Ok(ValidateCallbackResult::Valid),
            OpRecord::CloseChain { .. } => Ok(ValidateCallbackResult::Valid),
            OpRecord::InitZomesComplete { .. } => Ok(ValidateCallbackResult::Valid),
            _ => Ok(ValidateCallbackResult::Valid),
        },
        FlatOp::AgentActivity(agent_activity) => match agent_activity {
            OpActivity::CreateAgent { action, agent } => {
                let prev_action_hash = action.prev_action().cloned().ok_or(wasm_error!(
                    WasmErrorInner::Guest(
                        "CreateAgent action must have a previous action".into()
                    )
                ))?;
                let previous_action = must_get_action(prev_action_hash)?;
                match &previous_action.action().data {
                        ActionData::AgentValidationPkg(
                            AgentValidationPkgData { membrane_proof },
                        ) => validate_agent_joining(agent, membrane_proof),
                        _ => {
                            Ok(
                                ValidateCallbackResult::Invalid(
                                    "The previous action for a `CreateAgent` action must be an `AgentValidationPkg`"
                                        .to_string(),
                                ),
                            )
                        }
                    }
            }
            _ => Ok(ValidateCallbackResult::Valid),
        },
    }
}
