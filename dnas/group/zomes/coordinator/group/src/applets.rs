use std::collections::HashMap;

use group_integrity::*;
use hdk::prelude::*;

fn get_group_applets_path() -> Path {
    Path::from("group_applets")
}

fn get_federated_applets_path() -> Path {
    Path::from("federated_applets")
}

#[hdk_extern]
fn hash_applet(applet: Applet) -> ExternResult<EntryHash> {
    hash_entry(&applet)
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

/// First checks whether the same Applet has already been added to the group by someone
/// else and if not, will advertise it in the group DNA. Then it adds the Applet
/// entry as a private entry to the source chain.
#[hdk_extern]
fn register_applet(applet: Applet) -> ExternResult<EntryHash> {
    let applet_hash = hash_entry(&applet)?;

    // Advertise it in the group DNA if no-one else has done so yet
    match get(applet_hash.clone(), GetOptions::default()) {
        Ok(Some(_record)) => (),
        _ => {
            create_entry(EntryTypes::Applet(applet.clone()))?;

            let path = get_group_applets_path();
            let anchor_hash = path.path_entry_hash()?;
            create_link(
                anchor_hash,
                applet_hash.clone(),
                LinkTypes::AnchorToApplet,
                (),
            )?;
        }
    }

    // Create a link to your own public key for others to see that you joined that applet
    create_link(
        applet_hash.clone(),
        agent_info()?.agent_initial_pubkey,
        LinkTypes::AppletToAgent,
        (),
    )?;

    // Store a local copy of the Applet struct to the source chain as a private entry
    create_entry(EntryTypes::AppletPrivate(AppletCopy {
        public_entry_hash: applet_hash.clone(),
        applet: applet,
    }))?;
    Ok(applet_hash)
}

/// NOTE: This doesn't seem to affect what get_my_applets returns via source chain
/// query so it's not used atm.
/// Supposed to be called by everyone that installs an Applet that has already
/// been added to the group by someone else. Ensures that the applet entry is
/// on their own source chain and therefore retreivable without network call
// #[hdk_extern]
// fn delete_joined_applet(action_hash: ActionHash) -> ExternResult<ActionHash> {
//     let maybe_record = get_my_applet_copy(action_hash.clone())?;
//     match maybe_record {
//         Some(_record) => {
//             delete_entry(action_hash)
//         },
//         None => Err(wasm_error!(WasmErrorInner::Guest(String::from("Failed to delete private Applet Record: No existing private Applet entry found for this action hash."))))
//     }
// }

#[hdk_extern]
fn get_public_applet(applet_hash: EntryHash) -> ExternResult<Option<Record>> {
    get(applet_hash, GetOptions::default())
}

/// Gets the private entry copy for the given public Applet entry.
#[hdk_extern]
fn get_private_applet_copy(applet_hash: EntryHash) -> ExternResult<Option<AppletCopy>> {
    let private_applet_entry_type: EntryType = UnitEntryTypes::AppletPrivate.try_into()?;
    let filter = ChainQueryFilter::new()
        .entry_type(private_applet_entry_type)
        .include_entries(true);

    let records = query(filter)?;
    let applet_copies = records
        .into_iter()
        .map(|record| record.entry.to_app_option::<AppletCopy>().ok())
        .filter_map(|ac| ac)
        .filter_map(|ac| ac)
        .collect::<Vec<AppletCopy>>();
    Ok(applet_copies
        .into_iter()
        .find(|copy| copy.public_entry_hash == applet_hash))
}

/// Get the Applets that the calling agent has installed
#[hdk_extern]
fn get_my_applets(_: ()) -> ExternResult<Vec<EntryHash>> {
    let private_applet_entry_type: EntryType = UnitEntryTypes::AppletPrivate.try_into()?;
    let filter = ChainQueryFilter::new()
        .entry_type(private_applet_entry_type)
        .include_entries(true);

    let records = query(filter)?;

    Ok(records
        .into_iter()
        .map(|record| record.entry.to_app_option::<AppletCopy>().ok())
        .filter_map(|ac| ac)
        .filter_map(|ac| ac)
        .map(|applet_copy| applet_copy.public_entry_hash)
        .collect())
}

/// Get the Applets that the calling agent has installed
#[hdk_extern]
fn get_my_applet_copies(_: ()) -> ExternResult<Vec<AppletCopy>> {
    let private_applet_entry_type: EntryType = UnitEntryTypes::AppletPrivate.try_into()?;
    let filter = ChainQueryFilter::new()
        .entry_type(private_applet_entry_type)
        .include_entries(true);

    let records = query(filter)?;
    Ok(records
        .into_iter()
        .map(|record| record.entry.to_app_option::<AppletCopy>().ok())
        .filter_map(|ac| ac)
        .filter_map(|ac| ac)
        .collect::<Vec<AppletCopy>>())
}

/// Get all the Applets that have been registered in the group
#[hdk_extern]
fn get_group_applets(_: ()) -> ExternResult<Vec<EntryHash>> {
    let path = get_group_applets_path();

    let links = get_links(
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AnchorToApplet)?.build(),
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
    let my_applet_copies = get_my_applet_copies(())?;
    let my_applet_copies_public_hashes = my_applet_copies
        .into_iter()
        .map(|ac| ac.public_entry_hash)
        .collect::<Vec<EntryHash>>();

    let path = get_group_applets_path();

    let links = get_links(
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AnchorToApplet)?.build(),
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
    let my_applet_copies = get_my_applet_copies(())?;
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

/// Gets all the agents that joined the given Applet through calling register_applet
#[hdk_extern]
fn get_applet_agents(applet_hash: EntryHash) -> ExternResult<Vec<AgentPubKey>> {
    let links =
        get_links(GetLinksInputBuilder::try_new(applet_hash, LinkTypes::AppletToAgent)?.build())?;

    Ok(links
        .into_iter()
        .map(|link| AgentPubKey::try_from(link.target).ok())
        .filter_map(|pubkey| pubkey)
        .collect())
}

/// The person who registered the applet to the group may also archive it,
/// meaning that it won't be discovered by default anymore by agents that have not
/// installed it yet.
#[hdk_extern]
fn archive_applet(applet_hash: EntryHash) -> ExternResult<()> {
    let path = get_group_applets_path();

    let links = get_links(
        GetLinksInputBuilder::try_new(path.path_entry_hash()?, LinkTypes::AnchorToApplet)?.build(),
    )?;

    for link in links {
        // TODO Make this an actual validation rule
        if link.author != agent_info()?.agent_latest_pubkey {
            return Err(wasm_error!(WasmErrorInner::Guest(String::from(
                "Applet can only be archived by the same agent that registered it to the group."
            ))));
        }
        if let Some(target_applet_hash) = link.target.into_entry_hash() {
            if target_applet_hash.eq(&applet_hash) {
                delete_link(link.create_link_hash)?;
            }
        }
    }

    Ok(())
}

/// Anyone can unarchive it again, provided that they know the hash, i.e. have
/// had the Applet installed already
#[hdk_extern]
fn unarchive_applet(applet_hash: EntryHash) -> ExternResult<()> {
    let path = get_group_applets_path();
    let anchor_hash = path.path_entry_hash()?;
    create_link(
        anchor_hash,
        applet_hash.clone(),
        LinkTypes::AnchorToApplet,
        (),
    )?;

    Ok(())
}

#[hdk_extern]
fn get_archived_applets(_: ()) -> ExternResult<Vec<EntryHash>> {
    let path = get_group_applets_path();

    let links_details = get_link_details(
        path.path_entry_hash()?,
        LinkTypes::AnchorToApplet,
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

/// Registers the federation of an applet. The actual federation happens in the front-end
/// by installing the same applet in another group. It is only registered in the backend
/// *that* this applet has been federated.
#[hdk_extern]
pub fn register_applet_federation(
    input: RegisterAppletFederationInput,
) -> ExternResult<ActionHash> {
    create_link(
        input.applet_hash.clone(),
        input.group_dna_hash,
        LinkTypes::AppletToInvitedGroup,
        (),
    )?;
    let path = get_federated_applets_path();
    let anchor_hash = path.path_entry_hash()?;
    create_link(
        anchor_hash,
        input.applet_hash,
        LinkTypes::AnchorToFederatedApplet,
        (),
    )
}

/// Get the nearest-neighbor groups this app is federated with. The applet may in reality
/// be shared by arbitrarily many groups of which the group calling this function does
/// not know about ("viral federation").
#[hdk_extern]
pub fn get_federated_groups(applet_hash: EntryHash) -> ExternResult<Vec<EntryHash>> {
    let links = get_links(
        GetLinksInputBuilder::try_new(applet_hash, LinkTypes::AppletToInvitedGroup)?.build(),
    )?;

    Ok(links
        .into_iter()
        .filter_map(|link| link.target.into_entry_hash())
        .collect::<Vec<holo_hash::EntryHash>>())
}

/// Get Applets of this group that are knowingly federated with other groups
#[hdk_extern]
pub fn get_federated_applets(_: ()) -> ExternResult<Vec<EntryHash>> {
    let path = get_federated_applets_path();
    let anchor_hash = path.path_entry_hash()?;

    let links = get_links(
        GetLinksInputBuilder::try_new(anchor_hash, LinkTypes::AnchorToFederatedApplet)?.build(),
    )?;

    Ok(links
        .into_iter()
        .filter_map(|link| link.target.into_entry_hash())
        .collect::<Vec<holo_hash::EntryHash>>())
}
