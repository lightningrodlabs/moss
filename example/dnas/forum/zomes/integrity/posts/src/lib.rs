pub mod post;
use hdi::prelude::*;
pub use post::*;

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
#[hdk_entry_types]
#[unit_enum(UnitEntryTypes)]
pub enum EntryTypes {
    Post(Post),
}

#[derive(Serialize, Deserialize)]
#[hdk_link_types]
pub enum LinkTypes {
    PostUpdates,
    AllPosts,
    PeerSubscription,
}


/// Dna properties
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, SerializedBytes)]
#[serde(rename_all = "camelCase")]
pub struct ExampleDnaProperties {
   pub invalid: bool,
}

#[hdk_extern]
pub fn genesis_self_check(_data: GenesisSelfCheckData) -> ExternResult<ValidateCallbackResult> {
   let dna_info = dna_info()?;
   let props = dna_info.modifiers.properties;
   //debug!("props = {:?}", props);
   let maybe_properties: Result<ExampleDnaProperties, <ExampleDnaProperties as TryFrom<SerializedBytes>>::Error> = props.try_into();
   if let Err(e) = maybe_properties {
      return Err(wasm_error!("Deserializing dna properties failed: {:?}", e));
   }
   if maybe_properties.unwrap().invalid {
      return Ok(ValidateCallbackResult::Invalid("DNA Property explicitly invalid".to_string()));
   }
   Ok(ValidateCallbackResult::Valid)
}

pub fn validate_agent_joining(
    _agent_pub_key: AgentPubKey,
    _membrane_proof: &Option<MembraneProof>,
) -> ExternResult<ValidateCallbackResult> {
    Ok(ValidateCallbackResult::Valid)
}
#[hdk_extern]
pub fn validate(op: Op) -> ExternResult<ValidateCallbackResult> {
    match op.flattened::<EntryTypes, LinkTypes>()? {
        FlatOp::CreateEntry(store_entry) => match store_entry {
            OpEntry::CreateEntry { app_entry, action } => match app_entry {
                EntryTypes::Post(post) => validate_create_post(action.into(), post),
            },
            OpEntry::UpdateEntry {
                app_entry, action, ..
            } => match app_entry {
                EntryTypes::Post(post) => validate_create_post(action.into(), post),
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
                    EntryTypes::Post(post) => {
                        let original_app_entry = must_get_valid_record(original_action_address)?;
                        let original_post = match Post::try_from(original_app_entry) {
                            Ok(entry) => entry,
                            Err(e) => {
                                return Ok(ValidateCallbackResult::Invalid(format!(
                                    "Expected to get Post from Record: {e:?}"
                                )));
                            }
                        };
                        validate_update_post(action.into(), post, original_action, original_post)
                    }
                }
            }
            _ => Ok(ValidateCallbackResult::Valid),
        },
        FlatOp::Delete(delete_entry) => {
            let original_action_hash = delete_entry.action.data.deletes_address.clone();
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
                EntryTypes::Post(post) => {
                    validate_delete_post(delete_entry.action.into(), original_action, post)
                }
            }
        }
        FlatOp::Link(OpLink::CreateLink { link_type, action }) => {
            let base_address = action.data.base_address.clone();
            let target_address = action.data.target_address.clone();
            let tag = action.data.tag.clone();
            match link_type {
                LinkTypes::PostUpdates => validate_create_link_post_updates(
                    action.into(),
                    base_address,
                    target_address,
                    tag,
                ),
                LinkTypes::AllPosts => {
                    validate_create_link_all_posts(action.into(), base_address, target_address, tag)
                }
                LinkTypes::PeerSubscription => validate_create_link_peer_subscription(
                    action.into(),
                    base_address,
                    target_address,
                    tag,
                ),
            }
        }
        FlatOp::Link(OpLink::DeleteLink {
            original_action,
            link_type,
            action,
        }) => {
            let base_address = action.data.base_address.clone();
            let target_address = original_action.data.target_address.clone();
            let tag = original_action.data.tag.clone();
            match link_type {
                LinkTypes::PostUpdates => validate_delete_link_post_updates(
                    action.into(),
                    original_action.into(),
                    base_address,
                    target_address,
                    tag,
                ),
                LinkTypes::AllPosts => validate_delete_link_all_posts(
                    action.into(),
                    original_action.into(),
                    base_address,
                    target_address,
                    tag,
                ),
                LinkTypes::PeerSubscription => validate_delete_link_peer_subscription(
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
                EntryTypes::Post(post) => validate_create_post(action.into(), post),
            },
            OpRecord::UpdateEntry { app_entry, action } => {
                let original_action_hash = action.data.original_action_address.clone();
                let original_record = must_get_valid_record(original_action_hash)?;
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
                    EntryTypes::Post(post) => {
                        let result = validate_create_post(action.clone().into(), post.clone())?;
                        if let ValidateCallbackResult::Valid = result {
                            let original_post: Option<Post> = original_record
                                .entry()
                                .to_app_option()
                                .map_err(|e| wasm_error!(e))?;
                            let original_post = match original_post {
                                Some(post) => post,
                                None => {
                                    return Ok(
                                            ValidateCallbackResult::Invalid(
                                                "The updated entry type must be the same as the original entry type"
                                                    .to_string(),
                                            ),
                                        );
                                }
                            };
                            validate_update_post(action.into(), post, original_action, original_post)
                        } else {
                            Ok(result)
                        }
                    }
                }
            }
            OpRecord::DeleteEntry { action } => {
                let original_action_hash = action.data.deletes_address.clone();
                let original_record = must_get_valid_record(original_action_hash)?;
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
                    app_entry_type.zome_index.clone(),
                    app_entry_type.entry_index.clone(),
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
                    EntryTypes::Post(original_post) => {
                        validate_delete_post(action.into(), original_action, original_post)
                    }
                }
            }
            OpRecord::CreateLink { link_type, action } => {
                let base_address = action.data.base_address.clone();
                let target_address = action.data.target_address.clone();
                let tag = action.data.tag.clone();
                match link_type {
                    LinkTypes::PostUpdates => validate_create_link_post_updates(
                        action.into(),
                        base_address,
                        target_address,
                        tag,
                    ),
                    LinkTypes::AllPosts => validate_create_link_all_posts(
                        action.into(),
                        base_address,
                        target_address,
                        tag,
                    ),
                    LinkTypes::PeerSubscription => validate_create_link_peer_subscription(
                        action.into(),
                        base_address,
                        target_address,
                        tag,
                    ),
                }
            }
            OpRecord::DeleteLink { action } => {
                let original_action_hash = action.data.link_add_address.clone();
                let base_address = action.data.base_address.clone();
                let record = must_get_valid_record(original_action_hash)?;
                let original_action = record.action().clone();
                let create_link = match &original_action.data {
                    ActionData::CreateLink(create_link) => create_link.clone(),
                    _ => {
                        return Ok(ValidateCallbackResult::Invalid(
                            "The action that a DeleteLink deletes must be a CreateLink".to_string(),
                        ));
                    }
                };
                let link_type = match LinkTypes::from_type(
                    create_link.zome_index.clone(),
                    create_link.link_type.clone(),
                )? {
                    Some(lt) => lt,
                    None => {
                        return Ok(ValidateCallbackResult::Valid);
                    }
                };
                match link_type {
                    LinkTypes::PostUpdates => validate_delete_link_post_updates(
                        action.into(),
                        original_action,
                        base_address,
                        create_link.target_address,
                        create_link.tag,
                    ),
                    LinkTypes::AllPosts => validate_delete_link_all_posts(
                        action.into(),
                        original_action,
                        base_address,
                        create_link.target_address,
                        create_link.tag,
                    ),
                    LinkTypes::PeerSubscription => validate_delete_link_peer_subscription(
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
            OpActivity::CreateAgent { action, .. } => {
                let agent: AgentPubKey = action.data.entry_hash.clone().into();
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
