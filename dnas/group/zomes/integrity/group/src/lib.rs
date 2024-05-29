pub mod group_profile;
pub use group_profile::*;
pub mod applet;
pub use applet::*;
pub mod applet_private;
pub use applet_private::*;
pub mod joined_agent;
pub use joined_agent::*;
pub mod abandoned_agent;
pub use abandoned_agent::*;
pub mod steward_permission;
pub use steward_permission::*;
pub mod steward_permission_claim;
use hdi::prelude::*;
pub use steward_permission_claim::*;

#[derive(Clone, Serialize, Deserialize, Debug, SerializedBytes)]
pub struct GroupDnaProperties {
    pub progenitor: Option<AgentPubKeyB64>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type")]
#[hdk_entry_types]
#[unit_enum(UnitEntryTypes)]
pub enum EntryTypes {
    StewardPermission(StewardPermission),
    #[entry_type(visibility = "private")]
    StewardPermissionClaim(StewardPermissionClaim),
    Applet(Applet),
    #[entry_type(visibility = "private")]
    AppletPrivate(PrivateAppletEntry),
    GroupProfile(GroupProfile),
}
#[derive(Serialize, Deserialize)]
#[hdk_link_types]
pub enum LinkTypes {
    AgentToStewardPermissions,
    AllStewardPermissions,
    AllApplets,
    AllGroupProfiles,
    AppletToJoinedAgent,
    AppletToAbandonedAgent,
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
#[hdk_extern]
pub fn validate(op: Op) -> ExternResult<ValidateCallbackResult> {
    match op.flattened::<EntryTypes, LinkTypes>()? {
        FlatOp::StoreEntry(store_entry) => match store_entry {
            OpEntry::CreateEntry { app_entry, action } => match app_entry {
                EntryTypes::StewardPermission(steward_permission) => {
                    validate_create_steward_permission(
                        EntryCreationAction::Create(action),
                        steward_permission,
                    )
                }
                EntryTypes::Applet(applet) => {
                    validate_create_applet(EntryCreationAction::Create(action), applet)
                }
                EntryTypes::GroupProfile(group_profile) => validate_create_group_profile(
                    EntryCreationAction::Create(action),
                    group_profile,
                ),
                EntryTypes::AppletPrivate(applet_private) => validate_create_applet_private(
                    EntryCreationAction::Create(action),
                    applet_private,
                ),
                EntryTypes::StewardPermissionClaim(claim) => {
                    validate_create_steward_permission_claim(
                        EntryCreationAction::Create(action),
                        claim,
                    )
                }
            },
            OpEntry::UpdateEntry {
                app_entry, action, ..
            } => match app_entry {
                EntryTypes::StewardPermission(steward_permission) => {
                    validate_create_steward_permission(
                        EntryCreationAction::Update(action),
                        steward_permission,
                    )
                }
                EntryTypes::Applet(applet) => {
                    validate_create_applet(EntryCreationAction::Update(action), applet)
                }
                EntryTypes::GroupProfile(group_profile) => validate_create_group_profile(
                    EntryCreationAction::Update(action),
                    group_profile,
                ),
                EntryTypes::AppletPrivate(applet_private) => validate_create_applet_private(
                    EntryCreationAction::Update(action),
                    applet_private,
                ),
                EntryTypes::StewardPermissionClaim(claim) => {
                    validate_create_steward_permission_claim(
                        EntryCreationAction::Update(action),
                        claim,
                    )
                }
            },
            _ => Ok(ValidateCallbackResult::Valid),
        },
        FlatOp::RegisterUpdate(update_entry) => match update_entry {
            OpUpdate::Entry { app_entry, action } => {
                let original_action = must_get_action(action.clone().original_action_address)?
                    .action()
                    .to_owned();
                let original_create_action = match EntryCreationAction::try_from(original_action) {
                    Ok(action) => action,
                    Err(e) => {
                        return Ok(ValidateCallbackResult::Invalid(format!(
                            "Expected to get EntryCreationAction from Action: {e:?}"
                        )));
                    }
                };
                match app_entry {
                    EntryTypes::GroupProfile(group_profile) => {
                        let original_app_entry =
                            must_get_valid_record(action.clone().original_action_address)?;
                        let original_group_profile =
                            match GroupProfile::try_from(original_app_entry) {
                                Ok(entry) => entry,
                                Err(e) => {
                                    return Ok(ValidateCallbackResult::Invalid(format!(
                                        "Expected to get GroupProfile from Record: {e:?}"
                                    )));
                                }
                            };
                        validate_update_group_profile(
                            action,
                            group_profile,
                            original_create_action,
                            original_group_profile,
                        )
                    }
                    EntryTypes::Applet(applet) => {
                        let original_app_entry =
                            must_get_valid_record(action.clone().original_action_address)?;
                        let original_applet = match Applet::try_from(original_app_entry) {
                            Ok(entry) => entry,
                            Err(e) => {
                                return Ok(ValidateCallbackResult::Invalid(format!(
                                    "Expected to get Applet from Record: {e:?}"
                                )));
                            }
                        };
                        validate_update_applet(
                            action,
                            applet,
                            original_create_action,
                            original_applet,
                        )
                    }
                    EntryTypes::StewardPermission(steward_permission) => {
                        let original_app_entry =
                            must_get_valid_record(action.clone().original_action_address)?;
                        let original_steward_permission =
                            match StewardPermission::try_from(original_app_entry) {
                                Ok(entry) => entry,
                                Err(e) => {
                                    return Ok(ValidateCallbackResult::Invalid(format!(
                                        "Expected to get StewardPermission from Record: {e:?}"
                                    )));
                                }
                            };
                        validate_update_steward_permission(
                            action,
                            steward_permission,
                            original_create_action,
                            original_steward_permission,
                        )
                    }
                    EntryTypes::AppletPrivate(_) => Ok(ValidateCallbackResult::Invalid(
                        "A private applet entry cannot be updated".into(),
                    )),
                    EntryTypes::StewardPermissionClaim(_) => Ok(ValidateCallbackResult::Invalid(
                        "A private steward permission claim entry cannot be updated".into(),
                    )),
                }
            }
            _ => Ok(ValidateCallbackResult::Valid),
        },
        FlatOp::RegisterDelete(delete_entry) => {
            let original_action_hash = delete_entry.clone().action.deletes_address;
            let original_record = must_get_valid_record(original_action_hash)?;
            let original_record_action = original_record.action().clone();
            let original_action = match EntryCreationAction::try_from(original_record_action) {
                Ok(action) => action,
                Err(e) => {
                    return Ok(ValidateCallbackResult::Invalid(format!(
                        "Expected to get EntryCreationAction from Action: {e:?}"
                    )));
                }
            };
            let app_entry_type = match original_action.entry_type() {
                EntryType::App(app_entry_type) => app_entry_type,
                _ => {
                    return Ok(ValidateCallbackResult::Valid);
                }
            };
            match original_record.entry() {
                RecordEntry::Hidden => {
                    // Private entries can be deleted by the author of the record
                    if original_record.action().author() == &delete_entry.action.author {
                        return Ok(ValidateCallbackResult::Valid);
                    }
                }
                _ => (),
            }
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
                EntryTypes::GroupProfile(original_group_profile) => validate_delete_group_profile(
                    delete_entry.clone().action,
                    original_action,
                    original_group_profile,
                ),
                EntryTypes::Applet(original_applet) => validate_delete_applet(
                    delete_entry.clone().action,
                    original_action,
                    original_applet,
                ),
                EntryTypes::StewardPermission(original_steward_permission) => {
                    validate_delete_steward_permission(
                        delete_entry.clone().action,
                        original_action,
                        original_steward_permission,
                    )
                }
                // Note that a private entry should never show up down here in the first place
                _ => Ok(ValidateCallbackResult::Invalid(
                    "AppletPrivate match arm should never get called in the first place".into(),
                )),
            }
        }
        FlatOp::RegisterCreateLink {
            link_type,
            base_address,
            target_address,
            tag,
            action,
        } => match link_type {
            LinkTypes::AgentToStewardPermissions => {
                validate_create_link_agent_to_steward_permissions(
                    action,
                    base_address,
                    target_address,
                    tag,
                )
            }
            LinkTypes::AllStewardPermissions => validate_create_link_all_steward_permissions(
                action,
                base_address,
                target_address,
                tag,
            ),
            LinkTypes::AllApplets => {
                validate_create_link_all_applets(action, base_address, target_address, tag)
            }
            LinkTypes::AllGroupProfiles => {
                validate_create_link_all_group_profiles(action, base_address, target_address, tag)
            }
            LinkTypes::AppletToJoinedAgent => {
                validate_create_link_joined_agent(action, base_address, target_address, tag)
            }
            LinkTypes::AppletToAbandonedAgent => {
                validate_create_link_abandoned_agent(action, base_address, target_address, tag)
            }
        },
        FlatOp::RegisterDeleteLink {
            link_type,
            base_address,
            target_address,
            tag,
            original_action,
            action,
        } => match link_type {
            LinkTypes::AgentToStewardPermissions => {
                validate_delete_link_agent_to_steward_permissions(
                    action,
                    original_action,
                    base_address,
                    target_address,
                    tag,
                )
            }
            LinkTypes::AllStewardPermissions => validate_delete_link_all_steward_permissions(
                action,
                original_action,
                base_address,
                target_address,
                tag,
            ),
            LinkTypes::AllApplets => validate_delete_link_all_applets(
                action,
                original_action,
                base_address,
                target_address,
                tag,
            ),
            LinkTypes::AllGroupProfiles => validate_delete_link_all_group_profiles(
                action,
                original_action,
                base_address,
                target_address,
                tag,
            ),
            LinkTypes::AppletToJoinedAgent => validate_delete_link_joined_agent(
                action,
                original_action,
                base_address,
                target_address,
                tag,
            ),
            LinkTypes::AppletToAbandonedAgent => validate_delete_link_abandoned_agent(
                action,
                original_action,
                base_address,
                target_address,
                tag,
            ),
        },
        FlatOp::StoreRecord(store_record) => match store_record {
            OpRecord::CreateEntry { app_entry, action } => match app_entry {
                EntryTypes::StewardPermission(steward_permission) => {
                    validate_create_steward_permission(
                        EntryCreationAction::Create(action),
                        steward_permission,
                    )
                }
                EntryTypes::Applet(applet) => {
                    validate_create_applet(EntryCreationAction::Create(action), applet)
                }
                EntryTypes::GroupProfile(group_profile) => validate_create_group_profile(
                    EntryCreationAction::Create(action),
                    group_profile,
                ),
                EntryTypes::AppletPrivate(applet_private) => validate_create_applet_private(
                    EntryCreationAction::Create(action),
                    applet_private,
                ),
                EntryTypes::StewardPermissionClaim(claim) => {
                    validate_create_steward_permission_claim(
                        EntryCreationAction::Create(action),
                        claim,
                    )
                }
            },
            OpRecord::UpdateEntry {
                original_action_hash,
                app_entry,
                action,
                ..
            } => {
                let original_record = must_get_valid_record(original_action_hash)?;
                let original_action = original_record.action().clone();
                let original_action = match original_action {
                    Action::Create(create) => EntryCreationAction::Create(create),
                    Action::Update(update) => EntryCreationAction::Update(update),
                    _ => {
                        return Ok(ValidateCallbackResult::Invalid(
                            "Original action for an update must be a Create or Update action"
                                .to_string(),
                        ));
                    }
                };
                match app_entry {
                    EntryTypes::StewardPermission(steward_permission) => {
                        let result = validate_create_steward_permission(
                            EntryCreationAction::Update(action.clone()),
                            steward_permission.clone(),
                        )?;
                        if let ValidateCallbackResult::Valid = result {
                            let original_steward_permission: Option<StewardPermission> =
                                original_record
                                    .entry()
                                    .to_app_option()
                                    .map_err(|e| wasm_error!(e))?;
                            let original_steward_permission = match original_steward_permission {
                                Some(steward_permission) => steward_permission,
                                None => {
                                    return Ok(
                                            ValidateCallbackResult::Invalid(
                                                "The updated entry type must be the same as the original entry type"
                                                    .to_string(),
                                            ),
                                        );
                                }
                            };
                            validate_update_steward_permission(
                                action,
                                steward_permission,
                                original_action,
                                original_steward_permission,
                            )
                        } else {
                            Ok(result)
                        }
                    }
                    EntryTypes::Applet(applet) => {
                        let result = validate_create_applet(
                            EntryCreationAction::Update(action.clone()),
                            applet.clone(),
                        )?;
                        if let ValidateCallbackResult::Valid = result {
                            let original_applet: Option<Applet> = original_record
                                .entry()
                                .to_app_option()
                                .map_err(|e| wasm_error!(e))?;
                            let original_applet = match original_applet {
                                Some(applet) => applet,
                                None => {
                                    return Ok(
                                            ValidateCallbackResult::Invalid(
                                                "The updated entry type must be the same as the original entry type"
                                                    .to_string(),
                                            ),
                                        );
                                }
                            };
                            validate_update_applet(action, applet, original_action, original_applet)
                        } else {
                            Ok(result)
                        }
                    }
                    EntryTypes::GroupProfile(group_profile) => {
                        let result = validate_create_group_profile(
                            EntryCreationAction::Update(action.clone()),
                            group_profile.clone(),
                        )?;
                        if let ValidateCallbackResult::Valid = result {
                            let original_group_profile: Option<GroupProfile> = original_record
                                .entry()
                                .to_app_option()
                                .map_err(|e| wasm_error!(e))?;
                            let original_group_profile = match original_group_profile {
                                Some(group_profile) => group_profile,
                                None => {
                                    return Ok(
                                            ValidateCallbackResult::Invalid(
                                                "The updated entry type must be the same as the original entry type"
                                                    .to_string(),
                                            ),
                                        );
                                }
                            };
                            validate_update_group_profile(
                                action,
                                group_profile,
                                original_action,
                                original_group_profile,
                            )
                        } else {
                            Ok(result)
                        }
                    }
                    EntryTypes::AppletPrivate(_) => Ok(ValidateCallbackResult::Invalid(
                        "AppletPrivate entry cannot be updated.".into(),
                    )),
                    EntryTypes::StewardPermissionClaim(_) => Ok(ValidateCallbackResult::Invalid(
                        "StewardPermissionClaim entry cannot be updated.".into(),
                    )),
                }
            }
            OpRecord::DeleteEntry {
                original_action_hash,
                action,
                ..
            } => {
                let original_record = must_get_valid_record(original_action_hash)?;
                let original_action = original_record.action().clone();
                let original_action = match original_action {
                    Action::Create(create) => EntryCreationAction::Create(create),
                    Action::Update(update) => EntryCreationAction::Update(update),
                    _ => {
                        return Ok(ValidateCallbackResult::Invalid(
                            "Original action for a delete must be a Create or Update action"
                                .to_string(),
                        ));
                    }
                };
                let app_entry_type = match original_action.entry_type() {
                    EntryType::App(app_entry_type) => app_entry_type,
                    _ => {
                        return Ok(ValidateCallbackResult::Valid);
                    }
                };
                match original_record.entry() {
                    RecordEntry::Hidden => {
                        // Private entries can be deleted by the author of the record
                        if original_record.action().author() == &action.author {
                            return Ok(ValidateCallbackResult::Valid);
                        }
                    }
                    _ => (),
                }
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
                        return Ok(
                                ValidateCallbackResult::Invalid(
                                    "Original app entry must be one of the defined entry types for this zome"
                                        .to_string(),
                                ),
                            );
                    }
                };
                match original_app_entry {
                    EntryTypes::StewardPermission(original_steward_permission) => {
                        validate_delete_steward_permission(
                            action,
                            original_action,
                            original_steward_permission,
                        )
                    }
                    EntryTypes::Applet(original_applet) => {
                        validate_delete_applet(action, original_action, original_applet)
                    }
                    EntryTypes::GroupProfile(original_group_profile) => {
                        validate_delete_group_profile(
                            action,
                            original_action,
                            original_group_profile,
                        )
                    }
                    // Note that a private entry should never show up down here in the first place
                    _ => Ok(ValidateCallbackResult::Invalid(
                        "AppletPrivate match arm should never get called in the first place".into(),
                    )),
                }
            }
            OpRecord::CreateLink {
                base_address,
                target_address,
                tag,
                link_type,
                action,
            } => match link_type {
                LinkTypes::AgentToStewardPermissions => {
                    validate_create_link_agent_to_steward_permissions(
                        action,
                        base_address,
                        target_address,
                        tag,
                    )
                }
                LinkTypes::AllStewardPermissions => validate_create_link_all_steward_permissions(
                    action,
                    base_address,
                    target_address,
                    tag,
                ),
                LinkTypes::AllApplets => {
                    validate_create_link_all_applets(action, base_address, target_address, tag)
                }
                LinkTypes::AllGroupProfiles => validate_create_link_all_group_profiles(
                    action,
                    base_address,
                    target_address,
                    tag,
                ),
                LinkTypes::AppletToJoinedAgent => {
                    validate_create_link_joined_agent(action, base_address, target_address, tag)
                }
                LinkTypes::AppletToAbandonedAgent => {
                    validate_create_link_abandoned_agent(action, base_address, target_address, tag)
                }
            },
            OpRecord::DeleteLink {
                original_action_hash,
                base_address,
                action,
            } => {
                let record = must_get_valid_record(original_action_hash)?;
                let create_link = match record.action() {
                    Action::CreateLink(create_link) => create_link.clone(),
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
                    LinkTypes::AgentToStewardPermissions => {
                        validate_delete_link_agent_to_steward_permissions(
                            action,
                            create_link.clone(),
                            base_address,
                            create_link.target_address,
                            create_link.tag,
                        )
                    }
                    LinkTypes::AllStewardPermissions => {
                        validate_delete_link_all_steward_permissions(
                            action,
                            create_link.clone(),
                            base_address,
                            create_link.target_address,
                            create_link.tag,
                        )
                    }
                    LinkTypes::AllApplets => validate_delete_link_all_applets(
                        action,
                        create_link.clone(),
                        base_address,
                        create_link.target_address,
                        create_link.tag,
                    ),
                    LinkTypes::AllGroupProfiles => validate_delete_link_all_group_profiles(
                        action,
                        create_link.clone(),
                        base_address,
                        create_link.target_address,
                        create_link.tag,
                    ),
                    LinkTypes::AppletToJoinedAgent => validate_delete_link_joined_agent(
                        action,
                        create_link.clone(),
                        base_address,
                        create_link.target_address,
                        create_link.tag,
                    ),
                    LinkTypes::AppletToAbandonedAgent => validate_delete_link_abandoned_agent(
                        action,
                        create_link.clone(),
                        base_address,
                        create_link.target_address,
                        create_link.tag,
                    ),
                }
            }
            OpRecord::CreatePrivateEntry { .. } => Ok(ValidateCallbackResult::Valid),
            OpRecord::UpdatePrivateEntry { .. } => Ok(ValidateCallbackResult::Invalid(
                "Private entries cannot be updated.".into(),
            )),
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
        FlatOp::RegisterAgentActivity(agent_activity) => match agent_activity {
            OpActivity::CreateAgent { agent, action } => {
                let previous_action = must_get_action(action.prev_action)?;
                match previous_action.action() {
                        Action::AgentValidationPkg(
                            AgentValidationPkg { membrane_proof, .. },
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
