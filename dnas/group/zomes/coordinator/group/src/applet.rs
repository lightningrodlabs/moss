use std::collections::{BTreeMap, HashMap};

use group_integrity::*;
use hdk::prelude::*;

#[hdk_extern]
fn hash_applet(applet: Applet) -> ExternResult<EntryHash> {
    hash_entry(&applet)
}

#[hdk_extern]
fn register_and_join_applet(input: JoinAppletInput) -> ExternResult<EntryHash> {
    register_applet(input.applet.clone())?;
    join_applet(input)
}

/// Advertises the Applet in the group DNA.
#[hdk_extern]
fn register_applet(input: Applet) -> ExternResult<EntryHash> {
    let applet_hash = hash_entry(&input)?;

    create_entry(EntryTypes::Applet(input.clone()))?;

    let path = Path::from(ALL_APPLETS_ANCHOR);
    let anchor_hash = path.path_entry_hash()?;
    create_link(anchor_hash, applet_hash.clone(), LinkTypes::AllApplets, ())?;

    Ok(applet_hash)
}

#[derive(Serialize, Deserialize, Debug)]
struct JoinAppletInput {
    applet: Applet,
    joining_pubkey: AgentPubKey,
    membrane_proofs: Option<BTreeMap<String, SerializedBytes>>,
}

/// Adds the Applet entry as a private entry to the source chain and creates
/// links from the applet to the public key
#[hdk_extern]
fn join_applet(input: JoinAppletInput) -> ExternResult<EntryHash> {
    let applet_hash = hash_entry(&input.applet)?;

    // Create a link to your own public key for others to see that you joined that applet
    // The link also contains the public key that you use in the applet as the tag
    create_link(
        applet_hash.clone(),
        agent_info()?.agent_initial_pubkey,
        LinkTypes::AppletToJoinedAgent,
        LinkTag::new(input.joining_pubkey.get_raw_39()),
    )?;

    // Store a local copy of the Applet struct to the source chain as a private entry
    create_entry(EntryTypes::AppletPrivate(AppletEntryPrivate {
        public_entry_hash: applet_hash.clone(),
        applet: input.applet,
        applet_pubkey: input.joining_pubkey,
        membrane_proofs: input.membrane_proofs,
    }))?;

    Ok(applet_hash)
}

/// If an agent uninstalls an applet, they shall also mark it "abandoned" by them in the group DHT
#[hdk_extern]
fn abandon_applet(applet_hash: EntryHash) -> ExternResult<()> {
    let joined_agents_links = get_links(
        GetLinksInputBuilder::try_new(applet_hash.clone(), LinkTypes::AppletToJoinedAgent)?.build(),
    )?;

    let my_pubkey = agent_info()?.agent_initial_pubkey;

    for link in joined_agents_links {
        if link.target == AnyLinkableHash::from(my_pubkey.clone()) {
            // delete link and create abandoned link
            // TODO reconsider whether this link should really be deleted as it contains information
            // to resolve the public keys of other people in the group
            delete_link(link.create_link_hash)?;
            create_link(
                applet_hash.clone(),
                my_pubkey.clone(),
                LinkTypes::AppletToAbandonedAgent,
                LinkTag::new(my_pubkey.get_raw_39()),
            )?;
        }
    }

    Ok(())
}

/// The person who registered the applet to the group may also archive it,
/// meaning that it won't be discovered by default anymore by agents that have not
/// installed it yet.
#[hdk_extern]
fn archive_applet(applet_hash: EntryHash) -> ExternResult<()> {
    let path = Path::from(ALL_APPLETS_ANCHOR);

    let links = get_links(
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AllApplets)?.build(),
    )?;

    for link in links {
        if let Some(target_applet_hash) = link.target.into_entry_hash() {
            if target_applet_hash.eq(&applet_hash) {
                delete_link(link.create_link_hash)?;
            }
        }
    }

    Ok(())
}

#[hdk_extern]
fn unarchive_applet(applet_hash: EntryHash) -> ExternResult<()> {
    let path = Path::from(ALL_APPLETS_ANCHOR);
    let anchor_hash = path.path_entry_hash()?;
    create_link(anchor_hash, applet_hash.clone(), LinkTypes::AllApplets, ())?;

    Ok(())
}

#[hdk_extern]
fn get_applet(applet_hash: EntryHash) -> ExternResult<Option<Applet>> {
    // First try getting it from the source chain
    match get_private_applet_copy(applet_hash.clone()) {
        Ok(Some(applet_copy)) => Ok(Some(applet_copy.applet)),
        // Otherwise try getting it from the network
        Ok(None) => {
            let maybe_applet_record = get(applet_hash, GetOptions::default())?;
            match maybe_applet_record {
                Some(record) => record.entry.to_app_option::<Applet>().map_err(|e| {
                    wasm_error!(WasmErrorInner::Guest(format!(
                        "Failed to deserialize Applet from record: {}",
                        e
                    )))
                }),
                None => Ok(None),
            }
        }
        Err(e) => Err(e),
    }
}

/// Gets the private entry copy for the given public Applet entry.
#[hdk_extern]
fn get_private_applet_copy(applet_hash: EntryHash) -> ExternResult<Option<AppletEntryPrivate>> {
    let private_applet_entry_type: EntryType = UnitEntryTypes::AppletPrivate.try_into()?;
    let filter = ChainQueryFilter::new()
        .entry_type(private_applet_entry_type)
        .include_entries(true);

    let records = query(filter)?;
    let applet_copies = records
        .into_iter()
        .map(|record| record.entry.to_app_option::<AppletEntryPrivate>().ok())
        .filter_map(|ac| ac)
        .filter_map(|ac| ac)
        .collect::<Vec<AppletEntryPrivate>>();
    Ok(applet_copies
        .into_iter()
        .find(|copy| copy.public_entry_hash == applet_hash))
}

#[hdk_extern]
fn get_public_applet(applet_hash: EntryHash) -> ExternResult<Option<Record>> {
    get(applet_hash, GetOptions::default())
}

#[hdk_extern]
fn get_my_joined_applets(_: ()) -> ExternResult<Vec<AppletEntryPrivate>> {
    let private_applet_entry_type: EntryType = UnitEntryTypes::AppletPrivate.try_into()?;
    let filter = ChainQueryFilter::new()
        .entry_type(private_applet_entry_type)
        .include_entries(true);

    let records = query(filter)?;

    Ok(records
        .into_iter()
        .filter_map(|record| record.entry.to_app_option::<AppletEntryPrivate>().ok())
        .flatten()
        .collect())
}

#[hdk_extern]
fn get_group_applets(_: ()) -> ExternResult<Vec<EntryHash>> {
    let path = Path::from(ALL_APPLETS_ANCHOR);

    let links = get_links(
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AllApplets)?.build(),
    )?;

    let entry_hashes = links
        .into_iter()
        .filter_map(|link| link.target.into_entry_hash())
        .collect();

    Ok(entry_hashes)
}

/// Gets Applets that are registered in the group but have never been installed in
/// the local conductor yet, together with the agent pubkey of the agent that added
/// the applet to the group
#[hdk_extern]
fn get_unjoined_applets(_: ()) -> ExternResult<Vec<(EntryHash, AgentPubKey, Timestamp)>> {
    let my_applet_copies = get_my_joined_applets(())?;
    let my_applet_copies_public_hashes = my_applet_copies
        .into_iter()
        .map(|ac| ac.public_entry_hash)
        .collect::<Vec<EntryHash>>();

    let path = Path::from(ALL_APPLETS_ANCHOR);

    let links = get_links(
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AllApplets)?.build(),
    )?;

    let applet_infos: Vec<(EntryHash, AgentPubKey, Timestamp)> = links
        .into_iter()
        .filter(|link| link.target.clone().into_entry_hash().is_some())
        .map(|link| {
            (
                link.target.into_entry_hash().unwrap(),
                link.author,
                link.timestamp,
            )
        })
        .collect();

    Ok(applet_infos
        .into_iter()
        .filter(|(entry_hash, _author, _timestamp)| {
            !my_applet_copies_public_hashes.contains(entry_hash)
        })
        .collect())
}

/// Gets Applets that are registered in the group but have never been installed in
/// the local conductor yet and have already been archived by the person that initially
/// added it to the group
#[hdk_extern]
fn get_unjoined_archived_applets(_: ()) -> ExternResult<Vec<EntryHash>> {
    let my_applet_copies = get_my_joined_applets(())?;
    let my_applet_copies_public_hashes = my_applet_copies
        .into_iter()
        .map(|ac| ac.public_entry_hash)
        .collect::<Vec<EntryHash>>();

    let archived_applets = get_archived_applets(())?;

    Ok(archived_applets
        .into_iter()
        .filter(|entry_hash| !my_applet_copies_public_hashes.contains(entry_hash))
        .collect())
}

#[hdk_extern]
fn get_archived_applets(_: ()) -> ExternResult<Vec<EntryHash>> {
    let path = Path::from(ALL_APPLETS_ANCHOR);

    let links_details = get_link_details(
        path.path_entry_hash()?,
        LinkTypes::AllApplets,
        None,
        GetOptions::default(),
    )?;

    let mut links_details_by_target: HashMap<
        EntryHash,
        Vec<(CreateLink, Vec<SignedActionHashed>)>,
    > = HashMap::new();

    for (create_link, deletes) in links_details.into_inner() {
        if let Action::CreateLink(create_link) = create_link.action() {
            if let Some(target) = create_link.target_address.clone().into_entry_hash() {
                links_details_by_target
                    .entry(target)
                    .or_insert(vec![])
                    .push((create_link.clone(), deletes));
            }
        }
    }

    let entry_hashes = links_details_by_target
        .into_iter()
        .filter(|(_, details_for_target)| {
            details_for_target
                .iter()
                .all(|(_create, deletes)| deletes.len() > 0)
        })
        .map(|(target, _)| target)
        .collect();

    Ok(entry_hashes)
}

#[derive(Serialize, Deserialize, Debug)]
struct AppletAgent {
    group_pubkey: AgentPubKey,
    applet_pubkey: AgentPubKey,
}

/// Gets all the agents that joined the given Applet through calling register_applet
#[hdk_extern]
fn get_joined_applet_agents(applet_hash: EntryHash) -> ExternResult<Vec<AppletAgent>> {
    let links = get_links(
        GetLinksInputBuilder::try_new(applet_hash, LinkTypes::AppletToJoinedAgent)?.build(),
    )?;

    let mut applet_agents = Vec::new();

    for link in links {
        let maybe_group_pubkey = AgentPubKey::try_from(link.target).ok();
        let maybe_applet_pubkey = AgentPubKey::try_from_raw_39(link.tag.as_ref().to_owned()).ok();
        match (maybe_group_pubkey, maybe_applet_pubkey) {
            (Some(gk), Some(ak)) => applet_agents.push(AppletAgent {
                group_pubkey: gk,
                applet_pubkey: ak,
            }),
            _ => (),
        }
    }

    Ok(applet_agents)
}

/// Gets all the agents that abandoned the given Applet through calling abandon_applet
#[hdk_extern]
fn get_abandoned_applet_agents(applet_hash: EntryHash) -> ExternResult<Vec<AppletAgent>> {
    let links = get_links(
        GetLinksInputBuilder::try_new(applet_hash, LinkTypes::AppletToAbandonedAgent)?.build(),
    )?;

    let mut applet_agents = Vec::new();

    for link in links {
        let maybe_group_pubkey = AgentPubKey::try_from(link.target).ok();
        let maybe_applet_pubkey = AgentPubKey::try_from_raw_39(link.tag.as_ref().to_owned()).ok();
        match (maybe_group_pubkey, maybe_applet_pubkey) {
            (Some(gk), Some(ak)) => applet_agents.push(AppletAgent {
                group_pubkey: gk,
                applet_pubkey: ak,
            }),
            _ => (),
        }
    }

    Ok(applet_agents)
}
