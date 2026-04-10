use group_integrity::*;
use hdk::prelude::*;
use moss_helpers::ZomeFnInput;

#[hdk_extern]
pub fn create_steward_permission(steward_permission: StewardPermission) -> ExternResult<Record> {
    let steward_permission_hash =
        create_entry(&EntryTypes::StewardPermission(steward_permission.clone()))?;
    create_link(
        steward_permission.for_agent.clone(),
        steward_permission_hash.clone(),
        LinkTypes::AgentToStewardPermissions,
        (),
    )?;
    let record =
        get(steward_permission_hash.clone(), GetOptions::local())?.ok_or(wasm_error!(
            WasmErrorInner::Guest("Could not find the newly created StewardPermission".to_string())
        ))?;
    let path = Path::from("all_steward_permissions");
    create_link(
        path.path_entry_hash()?,
        steward_permission_hash.clone(),
        LinkTypes::AllStewardPermissions,
        LinkTag::new(steward_permission.for_agent.get_raw_39()),
    )?;
    Ok(record)
}

#[hdk_extern]
pub fn get_steward_permission(
    steward_permission_hash: ZomeFnInput<ActionHash>,
) -> ExternResult<Option<Record>> {
    let Some(details) = get_details(
        steward_permission_hash.input.clone(),
        steward_permission_hash.into(),
    )?
    else {
        return Ok(None);
    };
    match details {
        Details::Record(details) => Ok(Some(details.record)),
        _ => Err(wasm_error!(WasmErrorInner::Guest(
            "Malformed get details response".to_string()
        ))),
    }
}


#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", content = "content")]
pub enum Accountability {
    Progenitor,
    Steward(StewardPermissionClaim),
    Member,
}

#[hdk_extern]
pub fn get_my_accountabilities(input: ZomeFnInput<Timestamp>) -> ExternResult<Vec<Accountability>> {
    let my_pub_key = agent_info()?.agent_initial_pubkey;
    let mut accs = Vec::new();
    if is_agent_a_progenitor(my_pub_key.clone())? {
        accs.push(Accountability::Progenitor);
    }

    // query local chain for unlimited StewardPermissionClaims
    let permission_claim_entry_type: EntryType =
        UnitEntryTypes::StewardPermissionClaim.try_into()?;
    let filter = ChainQueryFilter::new()
        .entry_type(permission_claim_entry_type)
        .include_entries(true);

    let records = query(filter)?;
    let claims = records
        .into_iter()
        .map(|record| record.entry.to_app_option::<StewardPermissionClaim>().ok())
        .filter_map(|ac| ac)
        .filter_map(|ac| ac)
        .filter(|ac| ac.permission.for_agent == my_pub_key)
        .collect::<Vec<StewardPermissionClaim>>();

    match claims.into_iter().find(|c| c.permission.expiry.is_none()) {
        Some(claim) => accs.push(Accountability::Steward(claim)),
        // If no unlimited permission claim is found in source-chain, check the DHT
        None => {
            if let Some(claim) = is_agent_a_steward(my_pub_key, input.input, input.local)? {
                accs.push(Accountability::Steward(claim));
            }
        },
    }
    Ok(accs)
}

#[hdk_extern]
pub fn get_agent_accountabilities(arg: ZomeFnInput<(AgentPubKey, Timestamp)>) -> ExternResult<Vec<Accountability>> {
    let mut accs = Vec::new();
    if is_agent_a_progenitor(arg.input.0.clone())? {
        accs.push(Accountability::Progenitor);
    }

    if let Some(claim) = is_agent_a_steward(arg.input.0, arg.input.1, arg.local)? {
        accs.push(Accountability::Steward(claim));
    }
    Ok(accs)
}

/// Note: Optimized zome call
/// Note: Here we are not declaring everyone as progenitor if none is set in the dna properties
#[hdk_extern]
pub fn get_all_agents_accountabilities(
    input: ZomeFnInput<Timestamp>,
) -> ExternResult<Vec<(AgentPubKey, Accountability)>> {
    let mut result = Vec::new();
    // Check if there is a single progenitor
    let dna_properties =
        GroupDnaProperties::try_from(dna_info()?.modifiers.properties).map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize DNA properties: {e}"
            )))
        })?;
    if let Some(progenitor_b64) = dna_properties.progenitor {
        let progenitor = AgentPubKey::from(progenitor_b64);
        result.push((progenitor, Accountability::Progenitor));
    }
    // Get all steward permissions
    let all_permission_links =
    get_links(
        LinkQuery::try_new(Path::from("all_steward_permissions").path_entry_hash()?, LinkTypes::AllStewardPermissions)?
        , input.clone().into()
    )?;
    let mut pubkeys = all_permission_links
        .iter()
        .map(|l| AgentPubKey::try_from_raw_39(l.tag.0.clone()).ok())
        .filter_map(|pk| pk)
        .collect::<Vec<AgentPubKey>>();
    // deduplicate pubkeys
    let mut seen = HashSet::new();
    pubkeys.retain(|pk| seen.insert(pk.clone()));
    // Check if agents are stewards
    for agent in pubkeys {
        if let Some(claim) = is_agent_a_steward(agent.clone(), input.input, input.local)? {
            result.push((agent, Accountability::Steward(claim)));
        }
    }
    Ok(result)
}

pub fn is_agent_a_progenitor(agent: AgentPubKey) -> ExternResult<bool> {
    let dna_properties =
        GroupDnaProperties::try_from(dna_info()?.modifiers.properties).map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize DNA properties: {e}"
            )))
        })?;
    match dna_properties.progenitor {
        None => Ok(true),
        Some(progenitor_b64) => {
            let progenitor = AgentPubKey::from(progenitor_b64);
            Ok(agent == progenitor)
        }
    }
}

pub fn is_agent_a_steward(
    agent: AgentPubKey,
    now: Timestamp,
    local: Option<bool>,
) -> ExternResult<Option<StewardPermissionClaim>> {
    let options = match local {
        None => GetStrategy::default(),
        Some(true) => GetStrategy::Local,
        Some(false) => GetStrategy::Network,
    };
    let agent_permissions = get_links(
        LinkQuery::try_new(agent.clone(), LinkTypes::AgentToStewardPermissions)?
        , options
    )?;
    let mut expiring_permissions = Vec::new();
    for link in agent_permissions {
        let maybe_permission_action_hash = ActionHash::try_from(link.target).ok();
        let Some(permission_action_hash) = maybe_permission_action_hash else { continue };
        let maybe_permission_record = get(permission_action_hash, options.into())?;
        let Some(permission_record) = maybe_permission_record else { continue };
        match permission_record.entry().to_app_option::<StewardPermission>() {
            Ok(Some(permission)) => {
                match permission.expiry {
                    None => {
                        let claim = StewardPermissionClaim {
                            permission_hash: permission_record.action_address().clone(),
                            permission,
                        };
                        // If it's an unlimited permission and one for myself, store it as a private entry
                        if agent == agent_info()?.agent_initial_pubkey {
                            create_entry(EntryTypes::StewardPermissionClaim(
                                claim.clone(),
                            ))?;
                        }
                        return Ok(Some(claim));
                    }
                    Some(expiry) => {
                        expiring_permissions.push((
                            expiry,
                            StewardPermissionClaim {
                                permission_hash: permission_record
                                    .action_address()
                                    .clone(),
                                permission: permission,
                            },
                        ));
                    }
                }
            },
            _ => (),
        }
    }
    let max_expiry_permission = expiring_permissions
        .into_iter()
        .max_by(|a, b| a.0.cmp(&b.0));
    match max_expiry_permission {
        Some((expiry, claim)) => {
            if now > expiry {
                Ok(None)
            } else {
                Ok(Some(claim))
            }
        }
        None => Ok(None),
    }
}
