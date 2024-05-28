use group_integrity::*;
use hdk::prelude::*;

use crate::all_steward_permissions::get_all_steward_permissions;

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
        get(steward_permission_hash.clone(), GetOptions::default())?.ok_or(wasm_error!(
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
pub fn get_steward_permission(steward_permission_hash: ActionHash) -> ExternResult<Option<Record>> {
    let Some(details) = get_details(steward_permission_hash, GetOptions::default())? else {
        return Ok(None);
    };
    match details {
        Details::Record(details) => Ok(Some(details.record)),
        _ => Err(wasm_error!(WasmErrorInner::Guest(
            "Malformed get details response".to_string()
        ))),
    }
}
#[hdk_extern]
pub fn get_steward_permissions_for_agent(agent: AgentPubKey) -> ExternResult<Vec<Link>> {
    get_links(GetLinksInputBuilder::try_new(agent, LinkTypes::AgentToStewardPermissions)?.build())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", content = "content")]
pub enum PermissionLevel {
    Progenitor,
    Steward(StewardPermissionClaim),
    Member,
}

#[hdk_extern]
pub fn get_my_permission_level() -> ExternResult<PermissionLevel> {
    let dna_properties =
        GroupDnaProperties::try_from(dna_info()?.modifiers.properties).map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize DNA properties: {e}"
            )))
        })?;

    match dna_properties.progenitor {
        None => Ok(PermissionLevel::Progenitor),
        Some(progenitor_b64) => {
            let progenitor = AgentPubKey::from(progenitor_b64);
            let my_pub_key = agent_info()?.agent_initial_pubkey;
            if my_pub_key == progenitor {
                return Ok(PermissionLevel::Progenitor);
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
                .collect::<Vec<StewardPermissionClaim>>();

            match claims.into_iter().find(|c| c.permission.expiry.is_none()) {
                Some(claim) => Ok(PermissionLevel::Steward(claim)),
                // If no unlimited permission claim is found locally check the DHT
                None => network_get_agent_permission_level(my_pub_key),
            }
        }
    }
}

#[hdk_extern]
pub fn get_agent_permission_level(agent: AgentPubKey) -> ExternResult<PermissionLevel> {
    let dna_properties =
        GroupDnaProperties::try_from(dna_info()?.modifiers.properties).map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize DNA properties: {e}"
            )))
        })?;

    match dna_properties.progenitor {
        None => Ok(PermissionLevel::Progenitor),
        Some(progenitor_b64) => {
            let progenitor = AgentPubKey::from(progenitor_b64);
            if agent == progenitor {
                return Ok(PermissionLevel::Progenitor);
            }

            network_get_agent_permission_level(agent)
        }
    }
}

#[hdk_extern]
pub fn get_all_agent_permission_levels() -> ExternResult<Option<Vec<(AgentPubKey, PermissionLevel)>>>
{
    let dna_properties =
        GroupDnaProperties::try_from(dna_info()?.modifiers.properties).map_err(|e| {
            wasm_error!(WasmErrorInner::Guest(format!(
                "Failed to deserialize DNA properties: {e}"
            )))
        })?;

    match dna_properties.progenitor {
        None => Ok(None),
        Some(progenitor_b64) => {
            let mut permission_levels = Vec::new();
            let progenitor = AgentPubKey::from(progenitor_b64);
            permission_levels.push((progenitor, PermissionLevel::Progenitor));
            let all_permission_links = get_all_steward_permissions(())?;
            let mut pubkeys = all_permission_links
                .iter()
                .map(|l| AgentPubKey::from_raw_39(l.tag.0.clone()).ok())
                .filter_map(|pk| pk)
                .collect::<Vec<AgentPubKey>>();

            let mut seen = HashSet::new();
            pubkeys.retain(|pk| seen.insert(pk.clone()));

            for agent in pubkeys {
                let permission_level = network_get_agent_permission_level(agent.clone())?;
                permission_levels.push((agent, permission_level));
            }
            Ok(Some(permission_levels))
        }
    }
}

pub fn network_get_agent_permission_level(agent: AgentPubKey) -> ExternResult<PermissionLevel> {
    // If no unlimited permission claim is found locally, then check the DHT
    let links_to_agent_permissions = get_steward_permissions_for_agent(agent)?;

    let mut expiring_permissions = Vec::new();
    for link in links_to_agent_permissions {
        let maybe_permission_action_hash = ActionHash::try_from(link.target).ok();
        if let Some(permission_action_hash) = maybe_permission_action_hash {
            let maybe_permission_record = get(permission_action_hash, GetOptions::default())?;
            if let Some(permission_record) = maybe_permission_record {
                match permission_record
                    .entry()
                    .to_app_option::<crate::StewardPermission>()
                {
                    Ok(maybe_permission) => {
                        if let Some(permission) = maybe_permission {
                            match permission.expiry {
                                None => {
                                    // If it's an unlimited permission, store it as a private entry
                                    let claim = StewardPermissionClaim {
                                        permission_hash: permission_record.action_address().clone(),
                                        permission,
                                    };
                                    create_entry(EntryTypes::StewardPermissionClaim(
                                        claim.clone(),
                                    ))?;
                                    return Ok(PermissionLevel::Steward(claim));
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
                        }
                    }
                    Err(_e) => (),
                }
            }
        }
    }

    let max_expiry_permission = expiring_permissions
        .into_iter()
        .max_by(|a, b| a.0.cmp(&b.0));

    match max_expiry_permission {
        Some((expiry, claim)) => {
            let now = sys_time()?;
            if now > expiry {
                Ok(PermissionLevel::Member)
            } else {
                Ok(PermissionLevel::Steward(claim))
            }
        }
        None => Ok(PermissionLevel::Member),
    }
}
