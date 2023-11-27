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
fn get_applet(applet_hash: EntryHash) -> ExternResult<Option<Record>> {
    get(applet_hash, GetOptions::default())
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

    create_entry(EntryTypes::AppletPrivate(applet))?;
    Ok(applet_hash)
}

/// NOTE: This doesn't seem to affect what get_my_applets returns via source chain
/// query so it's not used atm.
/// Supposed to be called by everyone that installs an Applet that has already
/// been added to the group by someone else. Ensures that the applet entry is
/// on their own source chain and therefore retreivable without network call
#[hdk_extern]
fn delete_joined_applet(action_hash: ActionHash) -> ExternResult<ActionHash> {
    let maybe_record = get_my_applet(action_hash.clone())?;
    match maybe_record {
        Some(_record) => {
            delete_entry(action_hash)
        },
        None => Err(wasm_error!(WasmErrorInner::Guest(String::from("Failed to delete private Applet Record: No existing private Applet entry found for this action hash."))))
    }
}

/// Should always be retrievable from the local source chain as it
/// should have been added there by calling 'register_joined_applet'
#[hdk_extern]
fn get_group_applet(applet_hash: EntryHash) -> ExternResult<Option<Record>> {
    get(applet_hash, GetOptions::default())
}

/// Get the Applets that the calling agent has installed
#[hdk_extern]
fn get_my_applets(_: ()) -> ExternResult<Vec<EntryHash>> {
    let private_applet_entry_type: EntryType = UnitEntryTypes::AppletPrivate.try_into()?;
    let filter = ChainQueryFilter::new()
        .entry_type(private_applet_entry_type)
        .include_entries(true);

    let records = query(filter)?;

    Ok(
        records
            .into_iter()
            .filter_map(|record| record.action().entry_hash().cloned())
            .collect()
    )
}

/// Get the Applets that the calling agent has installed
#[hdk_extern]
fn get_my_applet(action_hash: ActionHash) -> ExternResult<Option<Record>> {
    let private_applet_entry_type: EntryType = UnitEntryTypes::AppletPrivate.try_into()?;
    let filter = ChainQueryFilter::new()
        .entry_type(private_applet_entry_type);
    let private_applet_records = query(filter)?;
    Ok(
        private_applet_records
            .into_iter()
            .find(|record| record.action_address().to_owned() == action_hash)
    )
}

/// Get all the Applets that have been registered in the group
#[hdk_extern]
fn get_group_applets(_: ()) -> ExternResult<Vec<EntryHash>> {
    let path = get_group_applets_path();

    let links = get_links(path.path_entry_hash()?, LinkTypes::AnchorToApplet, None)?;

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
fn get_unjoined_applets(_: ()) -> ExternResult<Vec<(EntryHash, AgentPubKey)>> {
    let my_applets = get_my_applets(())?;

    let path = get_group_applets_path();
    let links = get_links(path.path_entry_hash()?, LinkTypes::AnchorToApplet, None)?;

    let applet_infos: Vec<(EntryHash, AgentPubKey)> = links
        .into_iter()
        .filter(|link| link.target.clone().into_entry_hash().is_some())
        .map(|link| (link.target.into_entry_hash().unwrap(), link.author))
        .collect();

    Ok(
        applet_infos
            .into_iter()
            .filter(|(entry_hash, _author)| !my_applets.contains(entry_hash))
            .collect()
    )
}


/// The person who registered the applet to the group may also archive it,
/// meaning that it won't be discovered by default anymore by agents that have not
/// installed it yet.
#[hdk_extern]
fn archive_applet(applet_hash: EntryHash) -> ExternResult<()> {
    let path = get_group_applets_path();

    let links = get_links(path.path_entry_hash()?, LinkTypes::AnchorToApplet, None)?;

    for link in links {
        // TODO Make this an actual validation rule
        if link.author != agent_info()?.agent_latest_pubkey {
            return Err(wasm_error!(
                WasmErrorInner::Guest(
                    String::from("Applet can only be archived by the same agent that registered it to the group.")
                )
            ));
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

    let links_details = get_link_details(path.path_entry_hash()?, LinkTypes::AnchorToApplet, None)?;

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
pub fn register_applet_federation(input: RegisterAppletFederationInput) -> ExternResult<ActionHash> {
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
        ()
    )
}

/// Get the nearest-neighbor groups this app is federated with. The applet may in reality
/// be shared by arbitrarily many groups of which the group calling this function does
/// not know about ("viral federation").
#[hdk_extern]
pub fn get_federated_groups(applet_hash: EntryHash) -> ExternResult<Vec<EntryHash>> {
    let links = get_links(applet_hash, LinkTypes::AppletToInvitedGroup, None)?;
    Ok(
        links
            .into_iter()
            .filter_map(|link| link.target.into_entry_hash())
            .collect::<Vec<holo_hash::EntryHash>>()
    )
}


/// Get Applets of this group that are knowingly federated with other groups
#[hdk_extern]
pub fn get_federated_applets(_: ()) -> ExternResult<Vec<EntryHash>> {
    let path = get_federated_applets_path();
    let anchor_hash = path.path_entry_hash()?;
    let links = get_links(anchor_hash, LinkTypes::AnchorToFederatedApplet, None)?;
    Ok(
        links
            .into_iter()
            .filter_map(|link| link.target.into_entry_hash())
            .collect::<Vec<holo_hash::EntryHash>>()
    )
}